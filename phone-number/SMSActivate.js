const axios = require('axios');
const { EventEmitter } = require('events');

const API_URL = 'https://api.sms-activate.org/stubs/handler_api.php';
// const API_URL = 'https://eo2dmg1cvsw26e3.m.pipedream.net';

const MAX_GET_NUMBER_FAILS = 5; // Number of times failure to get number can occur before error
const MAX_CHECK_STATUS_FAILS = 10;

class SMSActivate extends EventEmitter {
    #APIKey
    #client
    #pollRate
    #shouldPoll = false;
    #checkErrors = 0;
    #textRead = false;

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
            params: {
                api_key: this.#APIKey
            },
            headers: {
                'Accept-Encoding': "*"
            }
        });
    }

    getNumber(config) {
        return new Promise(async (resolve, reject) => {
            const { service, country, validForInMS } = config;

            let success = false;
            let parsedResponse;
    
            for (let i = 0; i < MAX_GET_NUMBER_FAILS; i++) {
                try {
                    let numberRequest = await this.#client({
                        method: 'POST',
                        params: {
                            action: 'getNumber',
                            service: service,
                            country: country
                        }
                    });

                    if (numberRequest.status !== 200) continue;

                    parsedResponse = numberRequest.data.split(':');

                    if (parsedResponse.length === 3 && parsedResponse[0] === 'ACCESS_NUMBER') {
                        success = true;
                        break;
                    }
                } catch (e) {
                    console.log(e);
                }
            }

            if (success) {
                this.providerId = parsedResponse[1];
                this.number = parsedResponse[2];
                // this.expiresAt = Date.now() + validForInMS + 60000; // Add extra minute
                this.expiresAt = Date.now() + validForInMS;

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
                method: 'POST',
                params: {
                    action: 'setStatus',
                    id: this.providerId,
                    status: 8
                }
            });

            if (!this.#shouldPoll) {
                this.#shouldPoll = true;
                this.#monitor();
            }

        } catch (err) {
            this.emit('cancellation-error', { orderId: this.orderId, error: err });
        }
    }

    async #monitor() {
        try {
            let check = await this.#client({
                method: 'POST',
                params: {
                    action: 'getStatus',
                    id: this.providerId
                }
            });

            if (check.status !== 200) {
                throw new Error();
            }

            let parsedResponse = check.data.split(':');

            if (parsedResponse[0] === 'STATUS_CANCEL') { // Order is cancelled and refunded
                this.#shouldPoll = false;
                this.emit('cancelled', { orderId: this.orderId });
            } else if (parsedResponse[0] === 'STATUS_OK') { // Text has come through
                if (!this.#textRead) {
                    let fullText = await this.#client({
                        method: 'POST',
                        params: {
                            action: 'getFullSms',
                            id: this.providerId
                        }
                    });

                    if (fullText.status !== 200) throw new Error();

                    let parsedFullText = fullText.data.split(':');

                    this.emit('new-message', {
                        orderId: this.orderId,
                        code: parsedResponse[1],
                        fullText: parsedFullText.slice(1).join(':')
                    });

                    this.#textRead = true;

                    await this.#client({ // Immediately set the number to receive another text
                        method: 'POST',
                        params: {
                            action: 'setStatus',
                            id: this.providerId,
                            status: 3
                        }
                    });
                }
            } else if (parsedResponse[0] === 'STATUS_WAIT_CODE' || parsedResponse[0] === 'STATUS_WAIT_RETRY' || parsedResponse[0] === 'STATUS_WAIT_RESEND') { // Waiting for text
                // Continue to wait for code
                this.#textRead = false;
            } else if (parsedResponse[0] === 'BAD_STATUS') { // Invalid ID
                this.#shouldPoll = false;
                this.emit('invalid', { orderId: this.orderId });
                // this.stopMonitoring(true);
            } else { // Some sort of error
                this.#textRead = false;
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

module.exports = SMSActivate;