require('dotenv').config();
const VenmoAPI = require('../venmo/VenmoAPI');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const io = new Server({
    cors: {
        origin: "http://localhost:8080",
        methods: ["GET", "POST"]
    }
});

const venmo = new VenmoAPI(process.env.VENMO_BUSINESS_TOKEN, process.env.VENMO_BUSINESS_ID);
const pendingPaymentOrders = new Set();
const ordersWaitingForNumbers = new Map();
const completedOrders = new Map();

io.on('connection', (socket) => {
    socket.on('create-order', () => {
        const orderId = uuidv4();

        console.log(orderId);

        socket.join(orderId);
        pendingPaymentOrders.add(orderId);
        socket.emit('order-created', { orderId });
    });
});

venmo.on('new-transaction', async (tx) => {
    console.log(tx);
    let orderId;

    try {
        let parsedTx = tx.memo.split(':');

        if (parsedTx.length < 3) {
            console.log("here");
            venmo.refundTransaction(tx.id, tx.amount);
            return;
        }

        let service = parsedTx[1];
        orderId = parsedTx[2];

        if (!pendingPaymentOrders.has(orderId) && ordersWaitingForNumbers.has(orderId) && completedOrders.has(orderId)) {
            console.log("here 2");
            io.to(orderId).emit('invalid-session');
            await venmo.refundTransaction();
            return;
        }

        if (/* Lookup service and check that price paid is valid here */parseInt(tx.amount) !== 20) {
            console.log("here 3");
            io.to(orderId).emit('invalid-payment');
            await venmo.refundTransaction();
            return;
        }

        let order = {
            orderId: orderId,
            service: service,
            amount: tx.amount,
            venmoTransactionId: tx.id,
            customerVenmoId: tx.customerVenmoId
        }

        pendingPaymentOrders.delete(orderId);
        ordersWaitingForNumbers.set(orderId, order);

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

venmo.on('error', (err) => {
    console.log(err);
});

io.listen(3000);