require('dotenv').config();
const VenmoAPI = require('../venmo/VenmoAPI');
const { MongoClient } = require("mongodb");
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const venmo = new VenmoAPI(process.env.VENMO_BUSINESS_TOKEN, process.env.VENMO_BUSINESS_ID);
const client = new MongoClient(process.env.MONGO_URI);

const orderDB = client.db('orders');
const awaitingPaymentCollection = orderDB.collection('awaitingPayment');
const awaitingNumberCollection = orderDB.collection('awaitingNumber');
const completedOrderCollection = orderDB.collection('completed');

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

        if (/* Lookup service and check that price paid is valid here */parseInt(tx.amount) !== 20) {
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
            customerVenmoId: tx.customerVenmoId
        }

        // pendingPaymentOrders.delete(orderId);
        // ordersWaitingForNumbers.set(orderId, order);

        await awaitingPaymentCollection.deleteOne({ orderId: orderId });
        await awaitingNumberCollection.insertOne(order);

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