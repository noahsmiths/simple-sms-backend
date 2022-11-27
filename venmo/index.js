require('dotenv').config();
const VenmoAPI = require('./VenmoAPI');

const venmo = new VenmoAPI(process.env.VENMO_BUSINESS_TOKEN, process.env.VENMO_BUSINESS_ID);

venmo.on('new-transaction', (tx) => {
    console.log(tx);

    if (!tx.memo.includes("testtx") || tx.amount < 30) {
        console.log("Error in either memo or amount too low. Refunding in 5 seconds...");
        setTimeout(() => { venmo.refundTransaction(tx.id, tx.amount)}, 5000);
    }
});

venmo.on('error', (err) => {
    console.log(err);
});