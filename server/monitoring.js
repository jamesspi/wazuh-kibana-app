// External libraries
const cron      = require('node-cron');
const needle    = require('needle');
const getPath   = require('../util/get-path');

// Colors for console logging 
const colors    = require('ansicolors');
const blueWazuh = colors.blue('wazuh');

const APP_OBJECTS_FILE = './integration_files/app_objects_file_monitoring.json';

module.exports = (server, options) => {
	// Elastic JS Client
	const elasticRequest = server.plugins.elasticsearch.getCluster('admin');

	// Initialize
	let agentsArray   = [];
	let index_pattern = "wazuh-monitoring-*";
	let index_prefix  = "wazuh-monitoring-";
	let fDate         = new Date().toISOString().replace(/T/, '-').replace(/\..+/, '').replace(/-/g, '.').replace(/:/g, '').slice(0, -7);
	let todayIndex    = index_prefix + fDate;
	let packageJSON   = {};
	let app_objects = {};
	
	// Read Wazuh App package file
	try {
		packageJSON = require('../package.json');
	} catch (e) {
		server.log([blueWazuh, 'monitoring', 'error'], 'Could not read the Wazuh package file.');
	}

	// Check status and get agent status array
	const checkStatus = (apiEntry, maxSize, offset) => {
		if (!maxSize) {
			server.log([blueWazuh, 'monitoring', 'error'], 'You must provide a max size');
		}

		let payload = {
			'offset': offset ? offset: 0,
			'limit':  (250 < maxSize) ? 250 : maxSize
		};

		let options = {
			headers: {
				'wazuh-app-version': packageJSON.version
			},
			username:           apiEntry.user,
			password:           apiEntry.password,
			rejectUnauthorized: !apiEntry.insecure
		};

		needle
			.request('get', `${getPath(apiEntry)}/agents`, payload, options, (error, response) => {
			if (!error && !response.error && response.body.data.items) {
				agentsArray = agentsArray.concat(response.body.data.items);
				if ((payload.limit + payload.offset) < maxSize) {
					checkStatus(apiEntry, 
								response.body.data.totalItems, 
								payload.limit + payload.offset
					);
				} else {
					saveStatus();
				}
			} else {
				server.log([blueWazuh, 'monitoring', 'error'], 
						'Can not access Wazuh API');
			}
		});
	};

	// Check API status twice and get agents total items
	const checkAndSaveStatus = (apiEntry) => {
		let payload = {
			'offset': 0,
			'limit':  1
		};

		let options = {
			headers: {
				'wazuh-app-version': packageJSON.version
			},
			username: apiEntry.user,
			password: apiEntry.password,
			rejectUnauthorized: !apiEntry.insecure
		};
		needle('get', `${getPath(apiEntry)}/agents`, payload, options)
		.then((response) => {
			if (!response.error && response.body.data && response.body.data.totalItems) {
				checkStatus(apiEntry, response.body.data.totalItems);
			} else {
				server.log([blueWazuh, 'monitoring', 'error'], 
				'Wazuh API credentials not found or are not correct. '+
				'Open the app in your browser and configure it to start monitoring agents.');
			}
		});
	};

	// Load Wazuh API credentials from Elasticsearch document
	const loadCredentials = (apiEntries) => {
		if (typeof apiEntries === 'undefined' || !('hits' in apiEntries)) return;

		for(let element of apiEntries.hits){
			let apiEntry = {
				'user':     element._source.api_user,
				'password': Buffer.from(element._source.api_password, 'base64').toString("ascii"),
				'url':      element._source.url,
				'port':     element._source.api_port,
				'insecure': element._source.insecure
			};
			if (apiEntry.error) {
				server.log([blueWazuh, 'monitoring', 'error'], 
						`Error getting wazuh-api data: ${apiEntry.error}`);
				break;
			}
			checkAndSaveStatus(apiEntry);
		}
	};

	// Get API configuration from elastic and callback to loadCredentials
	const getConfig = (callback) => {
		elasticRequest
		.callWithInternalUser('search', {
			index: '.wazuh',
			type:  'wazuh-configuration'
		})
		.then((data) => {
			if (data.hits.total === 1) {
				callback(data.hits);
			} else {
				callback({
					'error':      'no credentials',
					'error_code': 1
				});
			}
		})
		.catch(() => {
			callback({
				'error':      'no elasticsearch',
				'error_code': 2
			});
		});
	};

	// Importing Wazuh app visualizations and dashboards
	const importAppObjects = (id) => {
		server.log([blueWazuh, 'monitoring', 'info'], 
					'Importing Wazuh app visualizations...');

		try {
			app_objects = require(APP_OBJECTS_FILE);
		} catch (e) {
			server.log([blueWazuh, 'monitoring', 'error'], 'Could not read the objects file.');
			server.log([blueWazuh, 'monitoring', 'error'], 'Path: ' + APP_OBJECTS_FILE);
			server.log([blueWazuh, 'monitoring', 'error'], 'Exception: ' + e);
		}

		let body = '';
		for(let element of app_objects){
			body += '{ "index":  { "_index": ".kibana", "_type": "doc", ' + 
			'"_id": "' + element._type + ':' + element._id + '" } }\n';

			let temp = {};
			let aux  = JSON.stringify(element._source);
			aux      = aux.replace("wazuh-monitoring", id);
			aux      = JSON.parse(aux);
			temp[element._type] = aux;
			
			if (temp[element._type].kibanaSavedObjectMeta.searchSourceJSON.index) {
				temp[element._type].kibanaSavedObjectMeta.searchSourceJSON.index = id;
			}
			
			temp["type"] = element._type;
			body        += JSON.stringify(temp) + "\n";
		}

		elasticRequest
		.callWithInternalUser('bulk', {
			index: '.kibana',
			body:  body
		})
		.then(() => elasticRequest.callWithInternalUser('indices.refresh', {
			index: ['.kibana', index_pattern]
		}))
		.then(() => {
			server.log([blueWazuh, 'monitoring', 'info'], 
			'Wazuh app visualizations were successfully installed. App ready to be used.');
		})
		.catch((error) => {
			server.log([blueWazuh, 'server', 'error'], 
					'Error importing objects into elasticsearch. Bulk request failed.');
		});
	};

	// fetchAgents on demand
	const fetchAgents = () => getConfig(loadCredentials);

	// Configure Kibana patterns.
	const configureKibana = () => {
		server.log([blueWazuh, 'monitoring', 'info'], 
					`Creating index pattern: ${index_pattern}`);

		// Call the internal API and wait for the response
		let options = {
			headers: {
				'kbn-version': packageJSON.kibana.version
			},
			json: true
		};

		let body = {
			attributes: {
				title:         index_pattern,
				timeFieldName: '@timestamp'
			}
		};

		let requestUrl = `${server.info.uri}/api/saved_objects/index-pattern`;
		needle('post', requestUrl, body, options)
		.then((resp) => {
			server.log([blueWazuh, 'monitoring', 'info'], 'Successfully created index-pattern.');
			// Import objects (dashboards and visualizations)
			importAppObjects(resp.body.id);
		})
		.catch((err) => {
			server.log([blueWazuh, 'monitoring', 'error'], 'Error creating index-pattern.');
		});
	};

	// Creating wazuh-monitoring index
	const createIndex = (todayIndex) => {
		elasticRequest
		.callWithInternalUser('indices.create', {
			index: todayIndex
		})
		.then(() => {
			server.log([blueWazuh, 'monitoring', 'info'], 
					'Successfully created today index.');
			insertDocument(todayIndex);
		})
		.catch((error) => {
			server.log([blueWazuh, 'monitoring', 'error'], 
					`Could not create ${todayIndex} index on elasticsearch.`);
		});
	};

	// Inserting one document per agent into Elastic. Bulk.
	const insertDocument = (todayIndex) => {
		let body = '';
		if (agentsArray.length > 0) {
			let managerName = agentsArray[0].name;

			for(let element of agentsArray){
				body += '{ "index":  { "_index": "' + todayIndex + '", "_type": "wazuh-agent" } }\n';
				let date              = new Date(Date.now()).toISOString();
				element["@timestamp"] = date;
				element["host"]       = managerName;
				body                 += JSON.stringify(element) + "\n";
			}

			if (body === '') {
				return;
			}

			elasticRequest
			.callWithInternalUser('bulk', {
				index: todayIndex,
				type:  'agent',
				body:  body
			})
			.then((response) => agentsArray.length = 0)
			.catch((err) => {
				server.log([blueWazuh, 'monitoring', 'error'], 
						'Error inserting agent data into elasticsearch. Bulk request failed.');
			});
		}
	};

	// Save agent status into elasticsearch, create index and/or insert document
	const saveStatus = () => {
		fDate      = new Date().toISOString().replace(/T/, '-').replace(/\..+/, '').replace(/-/g, '.').replace(/:/g, '').slice(0, -7);
		todayIndex = index_prefix + fDate;

		elasticRequest
		.callWithInternalUser('indices.exists', {
			index: todayIndex
		})
		.then((result) => {
			if (result) {
				insertDocument(todayIndex);
			} else {
				createIndex(todayIndex);
			}
		})
		.catch((error) => {
			server.log([blueWazuh, 'monitoring', 'error'], 
				`Could not check if the index ${todayIndex} exists.`);
		});
	};

	// Main. First execution when installing / loading App.
	const init = () => {
		server.log([blueWazuh, 'monitoring', 'info'], 'Creating today index...');
		saveStatus();

		elasticRequest
		.callWithInternalUser('search', {
			index: '.kibana',
			type:  'doc',
			q:     'index-pattern.title:"wazuh-monitoring-*"'
		})
		.then((data) => {
			if (data.hits.total === 1) {
				server.log([blueWazuh, 'monitoring', 'info'], 
							'Skipping index-pattern creation. Already exists.');
			} else {
				configureKibana();
			}
		})
		.catch((error) => {
			server.log([blueWazuh, 'monitoring', 'error'], 
						'Could not reach elasticsearch.');
		});
	};

    // Check Kibana server status
    const checkKibanaServer  = () => {
        return new Promise(function (resolve, reject) {

		let requestUrl = `${server.info.uri}/api/saved_objects/index-pattern`;
		needle('get', requestUrl)
		.then((resp) => {
            if (resp.statusCode == "200")
                resolve(resp)
            else
                reject(err)
		})
		.catch((err) => {
            reject(err)
		});
        })
    }

    // Check Elasticsearch Server status and .kibana index presence
    const checkElasticsearchServer  = () => {
        return new Promise(function (resolve, reject) {
            elasticRequest
            .callWithInternalUser('exists', {
                index: ".kibana",
                id:    packageJSON.kibana.version,
                type:  "config"
            })
            .then((data) => {
                checkKibanaServer().then((data) => {
                    if (data.statusCode == "200"){
                        resolve(data)
                    }else{
                        reject(data)
                    }
                })
                .catch((err) => {
                    reject(err)
                });
            })
            .catch((error) => {
                reject(error)
            });
        })
    }

	// Wait until Kibana server is ready
	const checkKibanaStatus = () => {
        checkElasticsearchServer()
        .then((data) => {init()})
        .catch((error) => {
            server.log([blueWazuh, 'monitoring', 'info'], 'Waiting Kibana and Elasticsearch servers to be ready....');
            setTimeout(() => checkKibanaStatus(), 3000);
        });
	};

	// Check Kibana index and if it is prepared, start the initialization of Wazuh App.
	checkKibanaStatus();

	// Cron tab for getting agent status.
	cron.schedule('0 */10 * * * *', () => {
		agentsArray.length = 0;
		getConfig(loadCredentials);
	}, true);

	module.exports = fetchAgents;
};