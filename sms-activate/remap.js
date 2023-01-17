const services = require('./services.json');
const serviceMappings = require('./service-mappings.json');
const fs = require('fs');

let newServices = {
    services: {}
}

const serviceMappingsName = {};

for (let service in serviceMappings) {
    serviceMappingsName[serviceMappings[service]] = service;
}

for (let service of services) {
    let mappingName = service.service_name_old || service.service_name;
    
    newServices.services[service.service_name] = {
        "service_name": service.service_name,
        "sms_activate_id": serviceMappingsName[mappingName],
        "5sim_id": "N/A",
        "provider_to_use": "sms_activate_id",
        "price_in_cents": 99,
        "country": 12,
        "number_valid_time_in_ms": 1200000
    }
}

fs.writeFileSync('./new_config.json', JSON.stringify(newServices));