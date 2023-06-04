const axios = require('axios');
const { EventEmitter } = require('events');

const SMSActivate = require('./SMSActivate');
const FiveSim = require('./FiveSim');
const UnitedSMS = require('./UnitedSMS');

const config = require('./config.json');
const services = config.services;

class PhoneAPI extends EventEmitter {
    #SMSActivateAPIKey
    #FiveSimAPIKey
    #UnitedSMSUsername
    #UnitedSMSPassword
    #activeNumbers

    constructor(keys) {
        super();

        this.#SMSActivateAPIKey = keys.smsActivateKey;
        this.#FiveSimAPIKey = keys.fiveSimKey;
        this.#UnitedSMSUsername = keys.unitedSMSUsername;
        this.#UnitedSMSPassword = keys.unitedSMSPassword;

        this.#activeNumbers = new Set();
    }

    getNumberByService(orderId, service) {
        return new Promise((resolve, reject) => {
            let serviceDetails = services?.[service];
            let provider = serviceDetails?.['provider_to_use'];
            let serviceId = serviceDetails?.[provider];
            let country = serviceDetails?.['country'];
            // let validTime = serviceDetails?.['number_valid_time_in_ms'];

            let api;
            let providerConfig = {
                service: serviceId,
                country: country,
            };

            switch (provider) {
                case "sms_activate_id":
                    api = new SMSActivate(this.#SMSActivateAPIKey, orderId);
                    providerConfig.validForInMS = serviceDetails?.['number_valid_time_in_ms'];
                break;
                case "5sim_id":
                    api = new FiveSim(this.#FiveSimAPIKey, orderId);
                    providerConfig.operator = serviceDetails?.['5sim_operator'] || 'virtual8';
                break;
                case "united_sms_id":
                    api = new UnitedSMS({ username: this.#UnitedSMSUsername, password: this.#UnitedSMSPassword }, orderId);
                break;
                default:
                    reject("Invalid service.");
                    return
                break;
            }

            api.getNumber(providerConfig)
                .then((instance) => {
                    // this.#activeNumbers.add(instance);

                    // instance.on('messages-updated', (data) => {

                    // });

                    // instance.on('number-')

                    // resolve(instance.number);
                    resolve({
                        orderId: orderId,
                        smsInstance: instance,
                        number: instance.number,
                        provider: provider
                    });
                })
                .catch((err) => {
                    reject(err);
                })
        });
    }

    getSmsInstance(orderId, provider, providerId, number, expiresAt, messages) {
        return new Promise((resolve, reject) => {
            let api;

            switch (provider) {
                case "sms_activate_id":
                    api = new SMSActivate(this.#SMSActivateAPIKey, orderId);
                break;
                case "5sim_id":
                    api = new FiveSim(this.#FiveSimAPIKey, orderId);
                break;
                case "united_sms":
                    api = new UnitedSMS({ username: this.#UnitedSMSUsername, password: this.#UnitedSMSPassword }, orderId);
                break;
                default:
                    reject("Invalid service.");
                    return;
                break;
            }

            api.providerId = providerId;
            api.number = number;
            api.expiresAt = expiresAt;
            api.messages = messages;

            api.startMonitoring();

            resolve(api);
        });
    }
}

module.exports = PhoneAPI;