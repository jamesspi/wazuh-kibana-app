module.exports = (server, options) => {
    // Elastic JS Client
    const elasticRequest = server.plugins.elasticsearch.getCluster('data');

    // Handlers

    const getAPIEntries = (req, reply) => {
        elasticRequest
        .callWithRequest(req, 'search', {
            index: '.wazuh',
            type:  'wazuh-configuration',
            size:  '100'
        })
        .then((data) => {
            reply(data.hits.hits);
        })
        .catch((error) => {
            reply(error);
        });
    };

    const deleteAPIEntries = (req, reply) => {
        elasticRequest
        .callWithRequest(req, 'delete', {
            index: '.wazuh',
            type:  'wazuh-configuration',
            id:    req.params.id
        })
        .then((data) => {
            reply(data);
        })
        .catch((error) => {
            reply(error);
        });
    };

    const setAPIEntryDefault = (req, reply) => {
        // Searching for previous default
        elasticRequest
        .callWithRequest(req, 'search', {
            index: '.wazuh',
            type:  'wazuh-configuration',
            q:     'active:true'
        })
        .then((data) => {
            if (data.hits.total === 1) {
                // Setting off previous default
                elasticRequest.callWithRequest(req, 'update', {
                    index: '.wazuh',
                    type:  'wazuh-configuration',
                    id:    data.hits.hits[0]._id,
                    body: {
                        doc: {
                            "active": "false"
                        }
                    }
                })
                .then(() => elasticRequest.callWithRequest(req, 'update', {
                        index: '.wazuh',
                        type:  'wazuh-configuration',
                        id:    req.params.id,
                        body: {
                            doc: {
                                "active": 'true'
                            }
                        }
                    })
                )
                .then(() => {
                    reply({
                        statusCode: 200,
                        message:    'ok'
                    });
                })
                .catch((error) => {
                    reply({
                        statusCode: 500,
                        error:      8,
                        message:    'Could not save data in elasticsearch'
                    }).code(500);
                });
            } else {
                // Set new default
                elasticRequest
                .callWithRequest(req, 'update', {
                    index: '.wazuh',
                    type:  'wazuh-configuration',
                    id:    req.params.id,
                    body: {
                        doc: {
                            "active": "true"
                        }
                    }
                })
                .then(() => {
                    reply({
                        'statusCode': 200,
                        'message':    'ok'
                    });
                })
                .catch((error) => {
                    reply({
                        'statusCode': 500,
                        'error':      8,
                        'message':    'Could not save data in elasticsearch'
                    }).code(500);
                });
            }
        })
        .catch((error) => {
            reply({
                'statusCode': 500,
                'error':      8,
                'message':    'Could not set API default entry'
            }).code(500);
        });
    };

    const getExtensions = (req, reply) => {
        elasticRequest
        .callWithRequest(req, 'search', {
            index: '.wazuh',
            type:  'wazuh-configuration'
        })
        .then((data) => {
            reply(data.hits.hits);
        })
        .catch((error) => {
            reply(error);
        });
    };

    const toggleExtension = (req, reply) => {
        // Toggle extenion state
        let extension = {};
        extension[req.params.extensionName] = (req.params.extensionValue === 'true');

        elasticRequest
        .callWithRequest(req, 'update', {
            index: '.wazuh',
            type:  'wazuh-configuration',
            id:    req.params.id,
            body: {
                doc: {
                    "extensions": extension
                }
            }
        })
        .then(() => {
            reply({
                'statusCode': 200,
                'message':    'ok'
            });
        })
        .catch((error) => {
            reply({
                'statusCode': 500,
                'error':      8,
                'message':    'Could not save data in elasticsearch'
            }).code(500);
        });
    };

    const saveAPI = (req, reply) => {
        if (!('user'     in req.payload) ||
            !('password' in req.payload) ||
            !('url'      in req.payload) ||
            !('port'     in req.payload)) {

                return reply({
                'statusCode': 400,
                'error':      7,
                'message':    'Missing data'
            }).code(400);

        }

        let settings = {
            api_user:     req.payload.user,
            api_password: req.payload.password,
            url:          req.payload.url,
            api_port:     req.payload.port,
            insecure:     req.payload.insecure,
            component:    'API',
            active:       req.payload.active,
            cluster_info: req.payload.cluster_info,
            extensions:   req.payload.extensions
        };

        elasticRequest
        .callWithRequest(req, 'create', {
                index:   '.wazuh',
                type:    'wazuh-configuration',
                id:      req.payload.id,
                body:    settings,
                refresh: true
        })
        .then((response) => {
            reply({
                statusCode: 200,
                message:    'ok',
                response:   response
            });
        })
        .catch((error) => {
            reply({
                statusCode: 500,
                error:      8,
                message:    'Could not save data in elasticsearch'
            }).code(500);
        });
    };

    const updateAPIHostname = (req, reply) => {
        elasticRequest
        .callWithRequest(req, 'update', {
            index: '.wazuh',
            type:  'wazuh-configuration',
            id:    req.params.id,
            body: {
                doc: {
                    "cluster_info": req.payload.cluster_info
                }
            }
        })
        .then(() => {
            reply({
                statusCode: 200,
                message:    'ok'
            });
        })
        .catch((error) => {
            reply({
                statusCode: 500,
                error:      8,
                message:    'Could not save data in elasticsearch'
            }).code(500);
        });
    };

    //Server routes

    /*
     * PUT /api/wazuh-api/settings
     * Save the given API into elasticsearch
     *
     **/
    server.route({
        method:  'PUT',
        path:    '/api/wazuh-api/settings',
        handler: saveAPI
    });

    /*
     * GET /api/wazuh-api/apiEntries
     * Get Wazuh-API entries list (Multimanager) from elasticsearch index
     *
     **/
    server.route({
        method:  'GET',
        path:    '/api/wazuh-api/apiEntries',
        handler: getAPIEntries
    });

    /*
     * DELETE /api/wazuh-api/settings
     * Delete Wazuh-API entry (multimanager) from elasticsearch index
     *
     **/
    server.route({
        method:  'DELETE',
        path:    '/api/wazuh-api/apiEntries/{id}',
        handler: deleteAPIEntries
    });

    /*
     * PUT /api/wazuh-api/settings
     * Set Wazuh-API as default (multimanager) on elasticsearch index
     *
     **/
    server.route({
        method:  'PUT',
        path:    '/api/wazuh-api/apiEntries/{id}',
        handler: setAPIEntryDefault
    });


    /*
     * PUT /api/wazuh-api/extension/toggle/documentId/extensionName/trueorfalse
     * Toggle extension state: Enable / Disable
     *
     **/
    server.route({
        method:  'PUT',
        path:    '/api/wazuh-api/extension/toggle/{id}/{extensionName}/{extensionValue}',
        handler: toggleExtension
    });

    /*
     * GET /api/wazuh-api/extension
     * Return extension state list
     *
     **/
    server.route({
        method:  'GET',
        path:    '/api/wazuh-api/extension',
        handler: getExtensions
    });

    /*
     * PUT /api/wazuh-api/updateApiHostname/apiId
     * Update the API hostname
     *
     **/
    server.route({
        method:  'PUT',
        path:    '/api/wazuh-api/updateApiHostname/{id}',
        handler: updateAPIHostname
    });

};