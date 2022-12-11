const axios = require('axios');
const { EventEmitter } = require('events');
const services = config.services;

const SMSActivate = require('./SMSActivate');
const FiveSim = require('./FiveSim');

const config = require('./config.json');

class PhoneAPI extends EventEmitter {
    #SMSActivateAPIKey
    #FiveSimAPIKey
    #activeNumbers

    constructor(smsActivateKey, fiveSimKey) {
        super();

        this.#SMSActivateAPIKey = smsActivateKey;
        this.#FiveSimAPIKey = fiveSimKey;

        this.#activeNumbers = new Set();
    }

    getNumberByService(service) {
        return new Promise((resolve, reject) => {
            let serviceDetails = services[service];
            let provider = serviceDetails?.provider_to_use;
            let serviceId = serviceDetails[provider];
            let api;

            switch (provider) {
                case "sms_activate_id":
                    api = new SMSActivate(this.#SMSActivateAPIKey);
                break;
                case "5sim_id":
                    api = new FiveSim(this.#FiveSimAPIKey);
                break;
                default:
                    reject("Invalid service.");
                    return
                break;
            }

            api.getNumber(serviceId)
                .then((instance) => {
                    this.#activeNumbers.add(instance);
                    
                    instance.on('messages-updated', (data) => {

                    });

                    instance.on('number-')

                    resolve(instance.number);
                })
                .catch((err) => {
                    reject(err);
                })
        });
    }
}

module.exports = PhoneAPI;