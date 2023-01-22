const axios = require('axios');
const { EventEmitter } = require('events');

const API_URL = 'https://5sim.net/v1/user';

const MAX_GET_NUMBER_FAILS = 5; // Number of times failure to get number can occur before error
const MAX_CHECK_STATUS_FAILS = 10;

class FiveSim extends EventEmitter {
    #APIKey
    #client
    #pollRate
    #shouldPoll = false;
    #checkErrors = 0;

    orderId

    providerId
    number
    expiresAt
    messages

    constructor(_key, _orderId, _pollRate = 5000) {
        super();

        this.#APIKey = _key;
        this.orderId = _orderId;
        this.#pollRate = _pollRate;

        this.#client = axios.create({
            baseURL: API_URL,
            headers: {
                'Authorization': `Bearer ${this.#APIKey}`,
                'Accept': 'application/json'
            }
        });

        this.messages = [];
    }

    getNumber(config) {
        return new Promise(async (resolve, reject) => {
            const { service, country, operator } = config;
            
            let success = false;
            let numberResponse;
    
            for (let i = 0; i < MAX_GET_NUMBER_FAILS; i++) {
                try {
                    let numberRequest = await this.#client({
                        method: 'GET',
                        url: `/buy/activation/${country}/${operator}/${service}`
                    });

                    if (numberRequest.status !== 200) continue;

                    if (numberRequest.data?.phone) {
                        numberResponse = numberRequest.data;
                        success = true;
                        break;
                    }
                } catch (e) {
                    console.log(e);
                }
            }

            if (success) {
                this.providerId = numberResponse.id;
                this.number = numberResponse.phone.substring(1); // Substring used to remove the + at the beginning
                // this.expiresAt = Date.now() + validForInMS + 60000; // Add extra minute
                this.expiresAt = (new Date(numberResponse.expires)).getTime();

                this.#shouldPoll = true;
                this.#checkErrors = 0;
                this.#monitor();
                // let smsInstance = new SMSActivateInstance(this.#APIKey, parsedResponse[1], parsedResponse[2]);
                resolve(this);
            } else {
                reject();
            }
        });
    }

    async cancel() {
        try {
            let cancellation = await this.#client({
                method: 'GET',
                url: `/cancel/${this.providerId}`
            });

            if (!this.#shouldPoll) {
                this.#shouldPoll = true;
                this.#monitor();
            }
        } catch (err) {
            console.log(err);
            this.emit('cancellation-error', { orderId: this.orderId, error: err });
        }
    }

    async #monitor() {
        try {
            let check = await this.#client({
                method: 'GET',
                url: `/check/${this.providerId}`
            });

            if (check.status === 404) {
                this.#shouldPoll = false;
                this.emit('invalid', { orderId: this.orderId });
                return;
            } else if (check.status !== 200) {
                throw new Error();
            }

            let checkResponse = check.data;

            if (checkResponse.status === 'CANCELED' || checkResponse.status === 'BANNED' || checkResponse.status === 'TIMEOUT') { // Order is cancelled and refunded
                this.#shouldPoll = false;
                this.emit('cancelled', { orderId: this.orderId });
            } else if (checkResponse.status === 'RECEIVED') { // Text has come through
                for (let i = this.messages.length; i < checkResponse.sms.length; i++) {
                    let currentMessage = checkResponse.sms[i];

                    let parsedMessage = {
                        orderId: this.orderId,
                        code: currentMessage.code,
                        fullText: currentMessage.text
                    }

                    this.messages.unshift(parsedMessage);

                    this.emit('new-message', parsedMessage);
                }
            } else if (checkResponse.status === 'FINISHED') {
                this.#shouldPoll = false;
                this.emit('cancelled', { orderId: this.orderId });
            }
            
            this.#checkErrors = 0;
        } catch (err) {
            console.log(err);
            this.#checkErrors++;
        }

        // if (this.expiresAt && Date.now() > this.expiresAt) {
        //     this.#shouldPoll = false;
        //     this.emit('expired', { orderId: this.orderId });
        // }

        if (this.#shouldPoll) {
            setTimeout(this.#monitor.bind(this), this.#pollRate);
        }
    }

    stopMonitoring(clearListeners = false) {
        this.#shouldPoll = false;

        if (clearListeners) {
            this.removeAllListeners();
        }
    }

    startMonitoring() {
        if (!this.#shouldPoll) {
            this.#shouldPoll = true;
            this.#monitor();
        }
    }
}

module.exports = FiveSim;