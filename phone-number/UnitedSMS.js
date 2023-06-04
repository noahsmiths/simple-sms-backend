const axios = require('axios');
const { EventEmitter } = require('events');

const API_URL = 'https://www.unitedsms.net/api_command.php';

const MAX_GET_NUMBER_FAILS = 5; // Number of times failure to get number can occur before error
const MAX_CHECK_STATUS_FAILS = 10;

class UnitedSMS extends EventEmitter {
    #APIUsername
    #APIPassword
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
    service

    constructor(_key, _orderId, _pollRate = 5000) {
        super();

        this.#APIUsername = _key.username;
        this.#APIPassword = _key.password;
        this.orderId = _orderId;
        this.#pollRate = _pollRate;

        this.#client = axios.create({
            baseURL: API_URL,
            params: {
                user: this.#APIUsername,
                pass: this.#APIPassword,
            },
        });
    }

    getNumber(config) {
        return new Promise(async (resolve, reject) => {
            try {
                const { service } = config;
            
                let success = false;
                let numberResponse;
        
                for (let i = 0; i < MAX_GET_NUMBER_FAILS; i++) {
                    try {
                        let numberRequest = await this.#client({
                            method: 'GET',
                            params: {
                                cmd: 'request',
                                service: service,
                            }
                        });
    
                        if (numberRequest.status !== 200) continue;
    
                        if (numberRequest.data?.status === 'ok' && numberRequest.data?.message?.[0]?.mdn) {
                            // this.service = service;
                            numberResponse = numberRequest.data;
                            success = true;
                            break;
                        }
    
                        if (numberRequest.data?.status === 'error') {
                            reject(numberRequest.data);
                            return;
                        }
                    } catch (e) {
                        console.log(e);
                    }
                }
    
                if (success) {
                    this.providerId = numberResponse.message[0].id;
                    this.number = numberResponse.message[0].mdn; // Substring used to remove the + at the beginning
                    // this.expiresAt = Date.now() + validForInMS + 60000; // Add extra minute
                    this.expiresAt = Date.now() + (numberResponse.message[0].till_expiration * 1000);
    
                    this.#shouldPoll = true;
                    this.#checkErrors = 0;
                    this.#monitor();
                    // let smsInstance = new SMSActivateInstance(this.#APIKey, parsedResponse[1], parsedResponse[2]);
                    resolve(this);
                } else {
                    reject("Number insuccessfully reserved from UnitedSMS");
                }
            } catch (err) {
                reject(err);
            }
        });
    }

    async cancel() {
        try {
            let cancellation = await this.#client({
                method: 'GET',
                params: {
                    cmd: 'reject',
                    id: this.providerId
                }
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
                params: {
                    cmd: 'request_status',
                    id: this.providerId
                }
            });

            if (check.status !== 200 || check.data.status !== 'ok' || check.data.message === undefined) {
                this.#checkErrors++;
                
                if (this.#checkErrors > MAX_CHECK_STATUS_FAILS) {
                    this.#shouldPoll = false;
                    // this.emit('invalid', { orderId: this.orderId });
                    this.emit('cancelled', { orderId: this.orderId });
                    // throw new Error();
                }
            }

            if (this.expiresAt < Date.now()) {
                await this.#client({ // Can't just directly call cancel method or else it will keep looping and failing until expiration time
                    method: 'GET',
                    params: {
                        cmd: 'reject',
                        id: this.providerId
                    }
                });
            }

            let checkResponse = check.data.message;

            if (checkResponse.status === 'Rejected' || checkResponse.status === 'Timed Out') { // Order is cancelled and refunded
                this.#shouldPoll = false;
                this.#checkErrors = 0;

                this.emit('cancelled', { orderId: this.orderId });
            } else if (checkResponse.status === 'Completed') {
                this.#checkErrors = 0;

                // Get messages and send new message if message array is longer
                // Make sure that when issuing new request to reuse the phone number that the returned price is 0, otherwise refund and cancel the transaction
                // this.emit('new-message', new-id-returned-from-reused-request);

                // 
                let { data: { message: sms }} = await this.#client({
                    method: 'GET',
                    params: {
                        cmd: 'read_sms',
                        // mdn: this.number,
                        id: this.providerId
                    }
                });

                let parsedMessage = {
                    orderId: this.orderId,
                    code: sms[0].pin,
                    fullText: sms[0].reply,
                };

                // sms = sms.filter((msg) => {
                //     return msg.timestamp < this.expiresAt;
                // });

                try {
                    let { data: {status, message}} = await this.#client({
                        method: 'GET',
                        params: {
                            cmd: 'request',
                            service: sms[0].service,
                            mdn: this.number
                        }
                    });

                    if (status === 'ok' && message.length > 0) {
                        if (+message[0].price == 0) {
                            this.providerId = message[0].id;

                            parsedMessage.providerId = this.providerId;
                            this.emit('new-message', parsedMessage);
                        } else {
                            this.emit('new-message', parsedMessage);
                            
                            await this.#client({ // Can't just directly call cancel method or else it will keep looping and failing until expiration time
                                method: 'GET',
                                params: {
                                    cmd: 'reject',
                                    id: message[0].id
                                }
                            });

                            this.#shouldPoll = false;
                            this.emit('cancelled', { orderId: this.orderId });
                        }
                    } else {
                        this.emit('new-message', parsedMessage);

                        await this.#client({ // Can't just directly call cancel method or else it will keep looping and failing until expiration time
                            method: 'GET',
                            params: {
                                cmd: 'reject',
                                id: this.providerId
                            }
                        });

                        this.#shouldPoll = false;
                        this.emit('cancelled', { orderId: this.orderId });
                    }
                } catch (err) {
                    this.emit('new-message', parsedMessage);

                    await this.#client({ // Can't just directly call cancel method or else it will keep looping and failing until expiration time
                        method: 'GET',
                        params: {
                            cmd: 'reject',
                            id: this.providerId
                        }
                    });

                    this.#shouldPoll = false;
                    this.emit('cancelled', { orderId: this.orderId });
                }

                // this.messages.unshift(parsedMessage);
                // this.emit('new-message', parsedMessage);
            }
            // } else if (checkResponse.status === 'Reserved') { // Text has come through
            //     // for (let i = this.messages.length; i < checkResponse.sms.length; i++) {
            //     //     let currentMessage = checkResponse.sms[i];

            //     //     let parsedMessage = {
            //     //         orderId: this.orderId,
            //     //         code: currentMessage.code,
            //     //         fullText: currentMessage.text
            //     //     }

            //     //     this.messages.unshift(parsedMessage);

            //     //     this.emit('new-message', parsedMessage);
            //     // }
            // } else if (checkResponse.status === 'Completed') {
            //     this.#shouldPoll = false;
            //     this.emit('cancelled', { orderId: this.orderId });
            // }
            
            // this.#checkErrors = 0;
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

module.exports = UnitedSMS;