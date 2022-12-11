require('dotenv').config();
const VenmoAPI = require('../venmo/VenmoAPI');
const { MongoClient } = require("mongodb");
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const PhoneAPI = require('../phone-number/PhoneAPI');
const { services } = require('../phone-number/config.json');

const venmo = new VenmoAPI(process.env.VENMO_BUSINESS_TOKEN, process.env.VENMO_BUSINESS_ID);
const phoneAPI = new PhoneAPI();
const client = new MongoClient(process.env.MONGO_URI);

const orderDB = client.db('orders');
const awaitingPaymentCollection = orderDB.collection('awaitingPayment');
const awaitingNumberCollection = orderDB.collection('awaitingNumber');
const awaitingFirstTextCollection = orderDB.collection('awaitingFirstText');
const completedOrderCollection = orderDB.collection('completed');
const cancelledOrderCollection = orderDB.collection('cancelled');

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
    
            await awaitingPaymentCollection.insertOne({ orderId: orderId });
            socket.join(orderId);
            socket.emit('order-created', { orderId });
        } catch (err) {
            socket.emit('error-creating-order');
        }
    });

    socket.on('get-order', async (id) => {
        // Get order status and send it back with the according event. Can either do events as separate socket.io events or just as a name in a returned object for a general update event
    });
});

venmo.on('new-transaction', async (tx) => {
    console.log(tx);
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
            timeCreated: Date.now()
        }

        // pendingPaymentOrders.delete(orderId);
        // ordersWaitingForNumbers.set(orderId, order);

        await awaitingNumberCollection.insertOne(order);
        await awaitingPaymentCollection.deleteOne({ orderId: orderId });

        io.to(orderId).emit('order-confirmed');
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

const getNumberForOrder = async (orderId) => {
    
}

const checkPaidAmountMatchesPrice = async (service, amount) => {
    return services[service]?.price_in_cents === amount && typeof amount === 'number';
}

const orderIdIsValid = async (id) => {
    try {
        let isAwaitingPayment = (await awaitingPaymentCollection.findOne({ orderId: id })) !== null;
        let notUsed = (await awaitingNumberCollection.findOne({ orderId: id })) === null && (await completedOrderCollection.findOne({ orderId: id })) === null;

        return isAwaitingPayment && notUsed;
    } catch (err) {
        console.log(err);
        return false;
    }
}

venmo.on('error', (err) => {
    console.log(err);
});

const port = 3000;
io.listen(port);

console.log(`Listening on port *:${port}`);