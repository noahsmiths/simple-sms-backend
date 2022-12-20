const { EventEmitter } = require('events');
const axios = require('axios');
const fs = require('fs');

class VenmoAPI extends EventEmitter {
    #token;
    #id;
    #shouldPoll;
    #pollRate;
    #client;

    // #mostRecentTransactionId = "";
    #mostRecentTransactionId = fs.existsSync('./newest_tx_id') ? fs.readFileSync('./newest_tx_id').toString() : "";
    #nextPageURL = "";

    constructor(token, accountId, shouldPoll = true, pollRate = 5000) {
        super();

        this.#token = token;
        this.#id = accountId;
        this.#shouldPoll = shouldPoll;
        this.#pollRate = pollRate;
        this.#client = axios.create({
            baseURL: 'https://api.venmo.com/v1'
        });
        this.#client.defaults.headers.common['User-Agent'] = "Venmo/10.3.0 (iPad; iOS 13.5; Scale/2.0)";
        this.#client.defaults.headers.common['device-id'] = "11111111-1111-1111-1111-111111111111";
        this.#client.defaults.headers.common['Authorization'] = `Bearer ${token}`;

        this.getTransactions()
            .then((transactions) => {
                if (transactions.length > 0) {
                    this.#mostRecentTransactionId = transactions[0].ledger_id;
                    fs.writeFileSync('./newest_tx_id', this.#mostRecentTransactionId);
                }

                this.checkForNewTransactions();
            })
            .catch(err => this.emit('error', err));
    }

    async checkForNewTransactions() {
        try {
            let transactions = await this.getTransactions();
            let i = 0;

            let newestTransactionId = transactions[0]?.ledger_id || "";

            // console.log(newestTransactionId);
            // console.log(transactions[i]);
            // console.log(this.#mostRecentTransactionId);
            // console.log(transactions[i] && transactions[i].ledger_id !== this.#mostRecentTransactionId);

            while (transactions[i] && transactions[i].ledger_id !== this.#mostRecentTransactionId) {
                let tx = transactions[i]; // Guaranteed to be new by the conditions of the while loop

                // console.log(tx);

                if (tx.status === "complete" && tx.movement_type === "credit" && !tx.refund_type && tx.transaction_type === "payment.purchase") {
                    this.emit("new-transaction", {
                        id: tx.ledger_id,
                        memo: tx.memo,
                        amount: tx.amount_in_cents,
                        customerVenmoId: tx.peer?.id
                    });
                }
                
                if (++i >= transactions.length) {
                    transactions = await this.getTransactions(true);
                    i = 0;
                }
            }

            this.#mostRecentTransactionId = newestTransactionId;
            fs.writeFileSync('./newest_tx_id', this.#mostRecentTransactionId);
        } catch (err) {
            this.emit('error', err);
        }

        if (this.#shouldPoll) {
            setTimeout(this.checkForNewTransactions.bind(this), this.#pollRate);
        }
    }

    getTransactions(getNext = false) {
        return new Promise(async (resolve, reject) => {
            try {
                let url = `/ledger/transaction-history?actor_id=${this.#id}&page_size=50`;

                if (getNext) {
                    if (this.#nextPageURL?.length > 0) {
                        url = this.#nextPageURL;
                    } else {
                        resolve([]);
                        return;
                    }
                }

                let transactions = await this.#client.get(url);

                this.#nextPageURL = transactions?.data?.pagination?.next || "";

                resolve(transactions.data.data);
            } catch (err) {
                reject(err);
            }
        });
    }

    refundTransaction(transactionId, amount) {
        return new Promise(async (resolve, reject) => {
            if (transactionId === undefined || amount === undefined) {
                reject("Either transactionId, amount, or both were not specified. Both parameters are REQUIRED!");
                return;
            }

            try {
                let refund = await this.#client({
                    method: 'POST',
                    url: '/payments/refund',
                    data: {
                        "refund_origination": "IN_APP",
                        "transaction_id": transactionId,
                        "amount_in_cents": parseInt(amount)
                    }
                });

                if (refund?.data?.data?.status === "complete") {
                    resolve("Refund complete");
                } else {
                    reject(refund?.data);
                }
            } catch (err) {
                if (err?.response?.data?.error?.title === "Original Transaction settled") {
                    resolve("Refund complete");
                } else {
                    reject(err);
                }
            }
        })
    }
}

module.exports = VenmoAPI;