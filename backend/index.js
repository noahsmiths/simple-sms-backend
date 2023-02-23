require('dotenv').config();
const VenmoAPI = require('../venmo/VenmoAPI');
const { MongoClient } = require("mongodb");
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const isValidUUIDV4 = require('is-valid-uuid-v4').isValidUUIDV4;
const PhoneAPI = require('../phone-number/PhoneAPI');
const { services } = require('../phone-number/config.json');
const { Webhook } = require('discord-webhook-node');

const venmo = new VenmoAPI(process.env.VENMO_BUSINESS_TOKEN, process.env.VENMO_BUSINESS_ID);
const phoneAPI = new PhoneAPI(process.env.SMS_ACTIVATE_KEY, process.env.FIVE_SIM_KEY);
const client = new MongoClient(process.env.MONGO_URI);
const hook = new Webhook("https://discord.com/api/webhooks/1077992935326482574/mF40YRlGilD2mKDzHZ9c_QqyvPoG88rUkpl5jrgru-t63mC7iVjwNQH-gW2I0tKE9Bm5");

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
        origin: ["http://localhost:3000", "https://simple-sms.io"],
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
        if (!orderId || !isValidUUIDV4(orderId)) {
            socket.emit('order-not-found');
            return;
        }

        let order;
        let isCancelled = false;

        if (await collectionHasOrder(cancelledOrderCollection, orderId)) {
            order = await cancelledOrderCollection.findOne({ orderId: orderId });
            isCancelled = true;
        } else if (await collectionHasOrder(completedOrderCollection, orderId)) {
            order = await completedOrderCollection.findOne({ orderId: orderId });
        } else if (await collectionHasOrder(activeOrderCollection, orderId)) {
            order = await activeOrderCollection.findOne({ orderId: orderId });
        } else if (await collectionHasOrder(awaitingFirstTextCollection, orderId)) {
            order = await awaitingFirstTextCollection.findOne({ orderId: orderId });
        }

        if (!order) {
            socket.emit('order-not-found');
            return;
        }

        socket.join(orderId);

        socket.emit('order', {
            number: order.number,
            // expiresAt: order.expiresAt - 60000,
            expiresAt: order.expiresAt,
            service: order.service,
            messages: order.messages,
            // messages: [{code: "456789", fullText: "Your code is 456789."}, {code: "890432", fullText: "Confirm with code 890432."}],
            isCancelled: isCancelled
        });

        // setTimeout(() => {
        //     socket.emit('new-message', {
        //         code: '999999',
        //         fullText: '999999 is your confirmation code!'
        //     });
        // }, 5000);
        // socket.emit('order');
        // Get order status and send it back with the according event. Can either do events as separate socket.io events or just as a name in a returned object for a general update event
    });

    socket.on('new-order', async (orderId) => {
        if (await orderIdIsValid(orderId)) {
            socket.join(orderId);
        }
    });

    // TODO: Do this
    socket.on('cancel-order', async (orderId) => {
        if (await orderCanBeRefunded(orderId)) {
            if (activeSMSMonitors.has(orderId)) {
                let smsInstance = await activeSMSMonitors.get(orderId);
                await smsInstance.cancel();

                hook.error("Order Cancelled", `Order ID`, `${orderId}`)
            }
            // else if (collectionHasOrder(awaitingFirstTextCollection, orderId)) {

            // }
            // else if (collectionHasOrder(awaitingNumberCollection, orderId)) {
        } else {
            socket.emit('order-cancellation-error', { error: "Order cannot be cancelled as number has been used." });
        }
    });

    console.log("connection made");

    socket.on('disconnect', () => {
        console.log("connection lost");
    })
});

venmo.on('new-transaction', async (tx) => {
    // console.log(tx);
    let orderId;

    try {
        let parsedTx = tx.memo.split(':');

        if (parsedTx.length < 3) {
            console.log("here");
            await venmo.refundTransaction(tx.id, tx.amount);
            return;
        }

        let service = parsedTx[1];
        orderId = parsedTx[2];

        if (tx.audience !== "private") {
            console.log("here 1");
            io.to(orderId).emit('invalid-audience');
            await venmo.refundTransaction(tx.id, tx.amount);
            io.to(orderId).emit('refunded');
            await awaitingPaymentCollection.deleteOne({ orderId: orderId });
            return;
        }

        if (!(await orderIdIsValid(orderId))/* !(await orderIdIsValid(orderId)) */) { // Order is invalid

            console.log("here 2");
            io.to(orderId).emit('invalid-session');
            await venmo.refundTransaction(tx.id, tx.amount);
            io.to(orderId).emit('refunded');
            await awaitingPaymentCollection.deleteOne({ orderId: orderId });
            return;
        }

        if (/* Lookup service and check that price paid is valid here */ /*parseInt(tx.amount) !== 20*/!checkPaidAmountMatchesPrice(service, parseInt(tx.amount))) {
            console.log("here 3");
            io.to(orderId).emit('invalid-payment');
            await venmo.refundTransaction(tx.id, tx.amount);
            io.to(orderId).emit('refunded');
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



        io.to(orderId).emit('order-confirmed', { orderId: orderId });

        await getNumberForOrder(orderId, service);
    } catch (err) {
        console.log(err);

        if (orderId && await collectionHasOrder(awaitingNumberCollection, orderId)) {
            await awaitingNumberCollection.deleteOne({ orderId: orderId });
        }

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

// this should be done now. TODO: better error handling and refund within the function with try and catch. also make sure its removed from awaitingNumber before refunding.
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

        let order = awaitingNumberCollection.findOne({ orderId: orderId });

        venmo.refundTransaction(order.venmoTransactionId, order.amount)
            .then(async () => {
                if (orderId) {
                    io.to(orderId).emit('refunded');
                }

                await cancelledOrderCollection.insertOne(order);
                await awaitingNumberCollection.deleteOne({ orderId: orderId });
            })
            .catch((err) => {
                if (orderId) {
                    io.to(orderId).emit('refund-error');
                }
            });
        // throw new Error("Couldn't get phone number for service");
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

    // Send webhook to discord 
    let updatedNumber = `+${order.number.substring(0, 1)} (${order.number.substring(1, 4)}) 
    ${order.number.substring(4, 7)}-${order.number.substring(7)}`;

    hook.success('Order Confirmed', `${orderId}`, `${updatedNumber}\n${service}`);


    await awaitingFirstTextCollection.insertOne(order);
    await awaitingNumberCollection.deleteOne({ orderId: orderId });

    monitorSms(smsInstance, orderId);

    io.to(orderId).emit('order-phone-number', number);

    venmo.commentOnTransaction(order.venmoTransactionId, `Your order is now active at: https://simple-sms.io/order/${orderId}`)
        .then(() => { })
        .catch(console.error);
}

const monitorSms = (smsInstance, orderId) => {
    activeSMSMonitors.set(orderId, smsInstance);

    smsInstance.on('cancellation-error', (msg) => {
        io.to(msg.orderId).emit('order-cancellation-error', { error: 'Issue cancelling with backend.' });
    });

    smsInstance.on('cancelled', async (msg) => {
        console.log('cancelled');
        let orderId = msg.orderId;

        try {
            // let isCancelled = await collectionHasOrder(cancelledOrderCollection, orderId);
            // let isComplete = await collectionHasOrder(completedOrderCollection, orderId);
            // let isActive = await collectionHasOrder(activeOrderCollection, orderId);

            if (await orderCanBeRefunded(orderId)) {
                let order = await awaitingFirstTextCollection.findOne({ orderId: orderId });

                await cancelledOrderCollection.insertOne(order);
                await awaitingFirstTextCollection.deleteOne({ orderId: orderId });
                venmo.refundTransaction(order.venmoTransactionId, order.amount)
                    .then(() => {
                        if (orderId) {
                            activeSMSMonitors.delete(orderId);
                            smsInstance.stopMonitoring(true);
                            io.to(orderId).emit('refunded');
                        }
                    })
                    .catch((err) => {
                        if (orderId) {
                            smsInstance.startMonitoring();
                            io.to(orderId).emit('refund-error');
                        }
                    });

                // activeSMSMonitors.delete(orderId);
                io.to(msg.orderId).emit('order-cancelled');
            } else if (await collectionHasOrder(activeOrderCollection, orderId)) {
                let order = await activeOrderCollection.findOne({ orderId: orderId });

                await completedOrderCollection.insertOne(order);
                await activeOrderCollection.deleteOne({ orderId: orderId });
            }
        } catch (err) {
            io.to(orderId).emit('order-cancellation-error', { error: 'Error cancelling order.' });
        }
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
                if (order.messages[0].code === code && order.messages[0].fullText === fullText) return;
            }

            let newMessage = {
                code: code,
                fullText: fullText
            };

            io.to(orderId).emit('new-message', newMessage);

            order.messages.unshift(newMessage);

            await activeOrderCollection.replaceOne({ orderId: orderId }, order, { upsert: true });

            if (isFirstText) {
                await awaitingFirstTextCollection.deleteOne({ orderId: orderId });
            }
        } catch (err) {
            // io.to(orderId).emit('')
        }
    });

    smsInstance.on('expired', async (msg) => {
        console.log('expired');
        let orderId = msg.orderId;

        try {

            if (await collectionHasOrder(awaitingFirstTextCollection, orderId)) {
                let order = await awaitingFirstTextCollection.findOne({ orderId: orderId });

                venmo.refundTransaction(order.venmoTransactionId, order.amount)
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

                await cancelledOrderCollection.insertOne(order);
                await awaitingFirstTextCollection.deleteOne({ orderId: orderId });
            } else if (await collectionHasOrder(activeOrderCollection, orderId)) {
                let order = await activeOrderCollection.findOne({ orderId: orderId });

                await completedOrderCollection.insertOne(order);
                await activeOrderCollection.deleteOne({ orderId: orderId });
            }
        } catch (err) {

        }

        activeSMSMonitors.delete(orderId);
        smsInstance.stopMonitoring(true);
    });

    smsInstance.on('invalid', async (msg) => {
        let orderId = msg.orderId;
    });
}

const checkPaidAmountMatchesPrice = (service, amount) => {
    return services[service]?.price_in_cents === amount && typeof amount === 'number';
}

// const orderIdIsValid = async (id) => {
//     try {
//         let isAwaitingPayment = (await awaitingPaymentCollection.findOne({ orderId: id })) !== null;
//         let notUsed = (await awaitingNumberCollection.findOne({ orderId: id })) === null && (await completedOrderCollection.findOne({ orderId: id })) === null && (await cancelledOrderCollection.findOne({ orderId: id })) === null;

//         return isAwaitingPayment && notUsed;
//     } catch (err) {
//         console.log(err);
//         return false;
//     }
// }
const orderIdIsValid = async (id) => {
    try {
        let isValid = isValidUUIDV4(id);
        let isCompleted = await collectionHasOrder(completedOrderCollection, id);
        let isCancelled = await collectionHasOrder(cancelledOrderCollection, id);
        let isActive = await collectionHasOrder(activeOrderCollection, id);
        let isAwaitingNumber = await collectionHasOrder(awaitingNumberCollection, id);
        let isAwaitingFirstText = await collectionHasOrder(awaitingFirstTextCollection, id);

        // console.log(isValid);
        // console.log(isCompleted);
        // console.log(isCancelled);
        // console.log(isActive);
        // console.log(isAwaitingNumber);
        // console.log(isAwaitingFirstText);
        // console.log(isValid && !isCompleted && !isCancelled && !isActive && !isAwaitingNumber && !isAwaitingFirstText);

        return isValid && !isCompleted && !isCancelled && !isActive && !isAwaitingNumber && !isAwaitingFirstText;
    } catch (err) {
        console.log(err);
        return false;
    }
}

const orderCanBeRefunded = async (orderId) => {
    let isCancelled = await collectionHasOrder(cancelledOrderCollection, orderId) !== false;
    let isComplete = await collectionHasOrder(completedOrderCollection, orderId) !== false;
    let isActive = await collectionHasOrder(activeOrderCollection, orderId) !== false;

    return !isCancelled && !isComplete && !isActive;
}

const collectionHasOrder = async (collection, orderId) => {
    return await collection.findOne({ orderId: orderId }) !== null;
}

venmo.on('error', (err) => {
    // console.error(err);
    console.error("venmo error");
});

const loadActiveOrders = async () => {
    let allOrdersWaitingForNumber = await awaitingNumberCollection.find().toArray();
    let allOrdersWaitingForFirstText = await awaitingFirstTextCollection.find().toArray();
    let allActiveOrders = await activeOrderCollection.find().toArray();

    let allOrdersWithNumber = allOrdersWaitingForFirstText.concat(allActiveOrders);

    for (let order of allOrdersWaitingForNumber) {
        let orderId = order.orderId;

        getNumberForOrder(orderId, order.service)
            .then(() => {
                console.log(`Loaded order ${orderId}`);
            })
            .catch(() => {
                venmo.refundTransaction(order.venmoTransactionId, order.amount)
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
            });
    }

    for (let order of allOrdersWithNumber) {
        let orderId = order.orderId;

        phoneAPI.getSmsInstance(orderId, order.provider, order.providerId, order.number, order.expiresAt, order.messages)
            .then((smsInstance) => {
                monitorSms(smsInstance, orderId);
            })
            .catch(console.error);
    }
}

loadActiveOrders();

const port = 3001;
io.listen(port);

console.log(`Listening on port *:${port}`);