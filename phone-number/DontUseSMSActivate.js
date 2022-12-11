const SMSActivateAPI = require('sms-activate');
const API_KEY =

class SMSActivate {
    #MAX_FAILS = 15;
    #CODE_TIMEOUT = 1200; // 20 minutes in seconds
    #POLL_RATE = 1000;
    #MAX_ERROR_COUNT = 10;

    constructor(key) {
        this.id = null;
        this.number = null;
        this.#api = new SMSActivateAPI(key);
    }

    getNumber() {
        return new Promise(async (resolve, reject) => {
            try {
                let data;

                let i = 0;
                for (i = 0; i < this.#MAX_FAILS; i++) {
                    try {
                        let attempt = await this.#api.getNumber('mm', 12); // mm for microsoft; go for google

                        if (attempt != null && attempt?.id && attempt?.number) {
                            data = attempt;
                            break;
                        }
                    } catch (e) {
                        
                    }
                }

                if (i >= this.#MAX_FAILS) {
                    reject(new Error("Reached maximum number of allowed attempts to get phone number"));
                    return;
                }

                this.id = data.id;
                this.number = data.number;

                await this.#api.setStatus(this.id, 1);

                resolve(this.number);
            } catch (err) {
                reject(err);
            }
        });
    }

    getCode() {
        return new Promise(async (resolve, reject) => {
            try {
                let count = 0;
                let errorCount = 0;

                const waitForCode = setInterval(async () => {
                    try {
                        if (count++ >= this.#CODE_TIMEOUT) {
                            reject(new Error("Greater than 20 minutes has passed while waiting for code."));
                            clearInterval(waitForCode);
                            await this.#api.setStatus(this.id, 8);
                            return;
                        }

                        const code = await this.#api.getCode(this.id);

                        if (code != null) {
                            let fullSMS = await this.#api.getFullSMS(this.id);
                            
                            resolve({
                                fullText: fullSMS,
                                code: code
                            });

                            clearInterval(waitForCode);
                            await this.#api.setStatus(this.id, 3);
                            return;
                        }
                    } catch (e) {
                        if (errorCount++ >= this.#MAX_ERROR_COUNT) {
                            reject(new Error("Error count exceded."));
                            clearInterval(waitForCode);
                            await this.#api.setStatus(this.id, 8);
                            return;
                        }
                    }
                }, this.#POLL_RATE);
            } catch (err) {
                reject(err);
                await this.#api.setStatus(this.id, 8);
                return;
            }
            
        });
    }
}

module.exports = SMSActivate;