require('dotenv').config();
const VenmoAPI = require('../venmo/VenmoAPI');
const { MongoClient } = require("mongodb");
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const PhoneAPI = require('../phone-number/PhoneAPI');
const { services } = require('../phone-number/config.json');

const venmo = new VenmoAPI(process.env.VENMO_BUSINESS_TOKEN, process.env.VENMO_BUSINESS_ID);
const phoneAPI = new PhoneAPI(process.env.SMS_ACTIVATE_KEY, process.env.FIVE_SIM_KEY);
const client = new MongoClient(process.env.MONGO_URI);

const orderDB = client.db('orders');
const awaitingPaymentCollection = orderDB.collection('awaitingPayment');
const awaitingNumberCollection = orderDB.collection('awaitingNumber');
const awaitingFirstTextCollection = orderDB.collection('awaitingFirstText');
const activeOrderCollection = orderDB.collection('active');
const completedOrderCollection = orderDB.collection('completed');
const cancelledOrderCollection = orderDB.collection('cancelled');

const activeSMSMonitors = new Map();

// const pendingPaymentOrders = new Set();
// const ordersWaitingForNumbers = new Map();
// const completedOrders = new Map();

const io = new Server({
    cors: {
        origin: "http://localhost:8080",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    socket.on('create-order', async () => {
        try {
            const orderId = uuidv4();

            console.log(orderId);
    
            await awaitingPaymentCollection.insertOne({ orderId: orderId, transactionCreatedAt: Date.now() });
            socket.join(orderId);
            socket.emit('order-created', { orderId });
        } catch (err) {
            socket.emit('error-creating-order');
        }
    });

    socket.on('get-order', async (orderId) => {
        socket.join(orderId);
        // socket.emit();
        // Get order status and send it back with the according event. Can either do events as separate socket.io events or just as a name in a returned object for a general update event
    });

    socket.on('cancel-order', async (orderId) => {
        if (await orderCanBeRefunded(orderId)) {
            if (activeSMSMonitors.has(orderId)) {
                let smsInstance = await activeSMSMonitors.get(orderId);

                await smsInstance.cancel();
            }
            // } else if (collectionHasOrder(awaitingNumberCollection, orderId)) {

            // } else if (collectionHasOrder(awaitingFirstTextCollection, orderId)) {

            // }
        } else {
            socket.emit('order-cancellation-error', { error: "Order cannot be refunded as number has been used." });
        }
    });
});

venmo.on('new-transaction', async (tx) => {
    // console.log(tx);
    let orderId;

    try {
        let parsedTx = tx.memo.split(':');

        if (parsedTx.length < 3) {
            console.log("here");
            await venmo.refundTransaction(tx.id, tx.amount);
            await awaitingPaymentCollection.deleteOne({ orderId: orderId });
            return;
        }

        let service = parsedTx[1];
        orderId = parsedTx[2];

        if (!(await orderIdIsValid(orderId))) { // Order is invalid

            console.log("here 2");
            io.to(orderId).emit('invalid-session');
            await venmo.refundTransaction(tx.id, tx.amount);
            await awaitingPaymentCollection.deleteOne({ orderId: orderId });
            return;
        }

        if (/* Lookup service and check that price paid is valid here */ /*parseInt(tx.amount) !== 20*/checkPaidAmountMatchesPrice(service, parseInt(tx.amount))) {
            console.log("here 3");
            io.to(orderId).emit('invalid-payment');
            await venmo.refundTransaction(tx.id, tx.amount);
            await awaitingPaymentCollection.deleteOne({ orderId: orderId });
            return;
        }

        let order = {
            orderId: orderId,
            service: service,
            amount: tx.amount,
            venmoTransactionId: tx.id,
            customerVenmoId: tx.customerVenmoId,
            transactionPaidAt: Date.now()
        }

        // pendingPaymentOrders.delete(orderId);
        // ordersWaitingForNumbers.set(orderId, order);

        await awaitingNumberCollection.insertOne(order);
        await awaitingPaymentCollection.deleteOne({ orderId: orderId });

        io.to(orderId).emit('order-confirmed');

        getNumberForOrder(orderId, service);
    } catch (err) {
        console.log(err);

        venmo.refundTransaction(tx.id, tx.amount)
            .then(() => {
                if (orderId) {
                    io.to(orderId).emit('refunded');
                }
            })
            .catch((err) => {
                if (orderId) {
                    io.to(orderId).emit('refund-error');
                }
            });
    }

    // if (!tx.memo.includes("testtx") || tx.amount < 30) {
    //     console.log("Error in either memo or amount too low. Refunding in 5 seconds...");
    //     setTimeout(() => { venmo.refundTransaction(tx.id, tx.amount)}, 5000);
    // }
});

const getNumberForOrder = async (orderId, service) => {
    let smsInstance;
    let number;
    let provider;

    try {
        let numberRequest = await phoneAPI.getNumberByService(orderId, service);
        
        smsInstance = numberRequest.smsInstance;
        number = numberRequest.number;
        provider = numberRequest.provider;
    } catch (err) {
        io.to(orderId).emit('error-getting-number');
        throw new Error("Couldn't get phone number for service");
    }

    let order = await awaitingNumberCollection.findOne({ orderId: orderId });

    if (order === null) {
        await smsInstance.cancel();
        return;
    }

    order.number = number;
    order.provider = provider;
    order.providerId = smsInstance.providerId;
    order.expiresAt = smsInstance.expiresAt;
    order.messages = [];

    activeSMSMonitors.set(orderId, smsInstance);

    smsInstance.on('cancellation-error', (msg) => {
        io.to(msg.orderId).emit('order-cancellation-error', { error: 'Issue cancelling with backend.' });
    });

    smsInstance.on('cancelled', async (msg) => {
        let orderId = msg.orderId;

        try {
            // let isCancelled = await collectionHasOrder(cancelledOrderCollection, orderId);
            // let isComplete = await collectionHasOrder(completedOrderCollection, orderId);
            // let isActive = await collectionHasOrder(activeOrderCollection, orderId);

            if (await orderCanBeRefunded(orderId)) {
                let order = await awaitingFirstTextCollection.findOne({ orderId: orderId });
                await venmo.refundTransaction(order.venmoTransactionId, order.amount);
                await cancelledOrderCollection.insertOne(order);
                await awaitingFirstTextCollection.deleteOne({ orderId: orderId });

                activeSMSMonitors.delete(orderId);
                io.to(msg.orderId).emit('order-cancelled');
            }
        } catch (err) {
            io.to(orderId).emit('order-cancellation-error', { error: 'Error cancelling order and refunding.' });
        }

        smsInstance.stopMonitoring(true);
    });

    smsInstance.on('new-message', async (msg) => {
        let orderId = msg.orderId;

        try {
            let { code, fullText } = msg;
            let isFirstText = false;
            let order;

            if (await collectionHasOrder(awaitingFirstTextCollection, orderId)) {
                order = await awaitingFirstTextCollection.findOne({ orderId: orderId });
                isFirstText = true;
            } else {
                order = await activeOrderCollection.findOne({ orderId: orderId });
            }

            let newMessage = {
                code: code,
                fullText: fullText
            };

            io.to(orderId).emit('new-message', newMessage);

            order.messages.push(newMessage);

            await activeOrderCollection.replaceOne({ orderId: orderId }, order, { upsert: true });
            
            if (isFirstText) {
                await awaitingFirstTextCollection.deleteOne({ orderId: orderId });
            }
        } catch (err) {
            // io.to(orderId).emit('')
        }
    });

    smsInstance.on('expired', async (msg) => {
        let orderId = msg.orderId;

        try {

            // if (await collectionHasOrder(awaitingFirstTextCollection, orderId)) {
            //     // let order = await awaitingFirstTextCollection.findOne({ orderId: orderId });


            // } else 
            if (await collectionHasOrder(activeOrderCollection, orderId)) {
                let order = await activeOrderCollection.findOne({ orderId: orderId });

                await completedOrderCollection.insertOne(order);
                await activeOrderCollection.deleteOne({ orderId: orderId });
            }
        } catch (err) {

        }

        activeSMSMonitors.delete(orderId);
        smsInstance.stopMonitoring(true);
    });

    await awaitingFirstTextCollection.insertOne(order);
    await awaitingNumberCollection.deleteOne({ orderId: orderId });

    io.to(orderId).emit('order-number', number);
}

const checkPaidAmountMatchesPrice = async (service, amount) => {
    return services[service]?.price_in_cents === amount && typeof amount === 'number';
}

const orderIdIsValid = async (id) => {
    try {
        //let isAwaitingPayment = (await awaitingPaymentCollection.findOne({ orderId: id })) !== null;
        let isAwaitingPayment = true;
        let notUsed = (await awaitingNumberCollection.findOne({ orderId: id })) === null && (await completedOrderCollection.findOne({ orderId: id })) === null && (await cancelledOrderCollection.findOne({ orderId: id })) === null;

        return isAwaitingPayment && notUsed;
    } catch (err) {
        console.log(err);
        return false;
    }
}

const orderCanBeRefunded = async (orderId) => {
    let isCancelled = await collectionHasOrder(cancelledOrderCollection, orderId) !== null;
    let isComplete = await collectionHasOrder(completedOrderCollection, orderId) !== null;
    let isActive = await collectionHasOrder(activeOrderCollection, orderId) !== null;

    return !isCancelled && !isComplete && !isActive;
}

const collectionHasOrder = async (collection, orderId) => {
    return await collection.findOne({ orderId: orderId }) !== null;
}

venmo.on('error', (err) => {
    console.log(err);
});

const port = 3000;
io.listen(port);

console.log(`Listening on port *:${port}`);