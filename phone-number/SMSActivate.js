const axios = require('axios');
const { EventEmitter } = require('events');

const API_URL = 'https://api.sms-activate.org/stubs/handler_api.php';

const MAX_FAILS = 5; // Number of times failure to get number can occur before error

class SMSActivate {
    #APIKey
    #client

    constructor(_key) {
        this.#APIKey = _key;

        this.#client = axios.create({
            baseURL: API_URL,
            params: {
                api_key: this.#APIKey
            }
        });
    }

    getNumber(service, country = 12) {
        return new Promise(async (resolve, reject) => {
            let success = false;
            let parsedResponse;
    
            for (let i = 0; i < MAX_FAILS; i++) {
                try {
                    let numberRequest = this.#client({
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

                }
            }

            if (success) {
                let smsInstance = new SMSActivateInstance(this.#APIKey, parsedResponse[1], parsedResponse[2]);
                resolve(smsInstance);
            } else {
                reject();
            }
        });
    }
}

class SMSActivateInstance extends EventEmitter {
    #APIKey
    #pollRate
    #shouldPoll

    id
    number

    constructor(_id, _number, _key, _pollRate = 10) {
        super();

        this.#APIKey = _key;

        this.id = _id;
        this.number = _number;

        this.#pollRate = this._pollRate;
        this.#shouldPoll = true;
        this.#monitor();
    }

    #monitor() {
        try {

        } catch (err) {

        }

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
        this.#shouldPoll = true;
        this.#monitor();
    }
}

module.exports = SMSActivate;