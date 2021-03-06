import rison from 'rison-node';
// Require config
let app = require('ui/modules').get('app/wazuh', []);

app.controller('agentsController', 
function ($scope, $q, $routeParams, $route, $location, $rootScope, timefilter, Notifier, appState, genericReq, apiReq, AgentsAutoComplete) {
	const notify              = new Notifier({ location: 'Agents' });
	$rootScope.page           = 'agents';
	$scope.agentsAutoComplete = AgentsAutoComplete;

	if ($location.search().tabView){
		$scope.tabView = $location.search().tabView;
	} else {
		$scope.tabView = "panels";
		$location.search("tabView", "panels");
	}

	if ($location.search().tab){
		$scope.tab = $location.search().tab;
	} else {
		$scope.tab = "preview";
		$location.search("tab", "preview");
	}

    //$rootScope.currentImplicitFilter = 'agent.id : "' + $scope._agent.id + '"';

    // Getting the timefilter, defaulting it otherwise
    if (timefilter.time) {
    	$scope.timeGTE = timefilter.time.from;
    	$scope.timeLT  = timefilter.time.to;
    } else {
    	$scope.timeGTE = "now-15m";
    	$scope.timeLT  = "now";
    }

    $scope.hideRing = (items) => {
        return $(".vis-container").length >= items;
    };

	// Object for matching nav items and Wazuh groups
	let tabFilters = {
		"overview": {
			"group": ""
		},
		"fim": {
			"group": "syscheck"
		},
		"policy_monitoring": {
			"group": "rootcheck"
		},
		"oscap": {
			"group": "oscap"
		},
		"audit": {
			"group": "audit"
		},
		"pci": {
			"group": ""
		}
	};

    // Switch subtab
    $scope.switchSubtab = (subtab) => {
        $location.search('_a', null);
        $scope.tabView = subtab;
    };

	$scope.switchTab = (tab) => {
        // Deleing app state traces in the url
        $location.search('_a', null);

		$scope.tab = tab;
		$location.search("tab", tab);

		$scope.loading 		  = true;

        // Update the implicit filter
        if ($scope.tab !== 'preview') {
        	if (tabFilters[$scope.tab].group === "") $rootScope.currentImplicitFilter = 'agent.id : "' + $scope._agent.id + '"';
        	else $rootScope.currentImplicitFilter = 'agent.id : "' + $scope._agent.id + '"' + ' rule.groups : "' + tabFilters[$scope.tab].group + '"';
        }
		$scope.checkAlerts($scope._agent.id)
		.then((data) => {
			$scope.results = data;
			$scope.loading = false;
		})
		.catch(() => {
			$scope.results = false;
			$scope.loading = false;
		});
	};

	//Print Error
	const printError = (error) => notify.error(error.message);

	// Check if there are any alert.
	$scope.checkAlerts = (agent_id) => {
		let group   = null;
        if (tabFilters[$scope.tab].group === '')
            group = "*";
        else group = tabFilters[$scope.tab].group;
		let payload = {};
		let fields = {
			"fields": [{
				"field": "rule.groups",
				"value": group
			}, {
				"field": "agent.id",
				"value": agent_id
			}]
		};

		// No filter needed for general/pci
		if (group === '*'){
			fields = {
				"fields": [{
					"field": "agent.id",
					"value": agent_id
				}]
			};
		}

		let clusterName = {
			"cluster": appState.getClusterInfo().cluster
		};
		
		let timeInterval = {
			"timeinterval": {
				"gte": $scope.timeGTE,
				"lt":  $scope.timeLT
			}
		};

		angular.extend(payload, fields, clusterName, timeInterval);

		let deferred = $q.defer();
		genericReq.request('POST', '/api/wazuh-elastic/alerts-count/', payload)
		.then((data) => {
			if (data.data.data !== 0){
				deferred.resolve(true);
			} else {
				deferred.resolve(false);
			}
		});

		return deferred.promise;
	};

	$scope.getAgentStatusClass = (agentStatus) => agentStatus === "Active" ? "green" : "red";

	$scope.formatAgentStatus = (agentStatus) => {
		let condition = (agentStatus !== "Active" || agentStatus === "Disconnected");
		return (condition) ? "Never connected" : agentStatus;
	};

	$scope.extensionStatus = (extension) => appState.getExtensions().extensions[extension];

	$scope.applyAgent = (agent) => {
		if (agent) {
			$scope.loading        = true;
			$scope.tab = 'overview';
			$location.search("tab", 'overview');

			$scope.agentInfo      = {};
			// Get Agent Info
			apiReq.request('GET', `/agents/${agent.id}`, {})
			.then((data) => {

				$scope.agentInfo = data.data.data;
				$rootScope.agent = $scope.agentInfo;
				if (typeof $scope.agentInfo.version === 'undefined') {
					$scope.agentInfo.version = "Unknown";
				}
				if (typeof $scope.agentInfo.os === 'undefined') {
					$scope.agentOs = "Unknown";
				} else {
					if (typeof $scope.agentInfo.os.name !== 'undefined') {
						$scope.agentOs = `${$scope.agentInfo.os.name} ${$scope.agentInfo.os.version}`;
					} else {
						if (typeof $scope.agentInfo.os.uname !== 'undefined') {
							$scope.agentOs = $scope.agentInfo.os.uname;
						} else {
							$scope.agentOs = "Unknown";
						}
					}
				}

				if (typeof $scope.agentInfo.lastKeepAlive === 'undefined') {
					$scope.agentInfo.lastKeepAlive = "Unknown";
				}

				$scope._agent = data.data.data;
				$scope.search = data.data.data.name;
				$location.search('id', $scope._agent.id);

	        	// Update the implicit filter
		        if ($scope.tab !== 'preview') {
		        	if (tabFilters[$scope.tab].group === "") $rootScope.currentImplicitFilter = 'agent.id : "' + $scope._agent.id + '"';
		        	else $rootScope.currentImplicitFilter = 'agent.id : "' + $scope._agent.id + '"' + ' rule.groups : "' + tabFilters[$scope.tab].group + '"';
		        }

				$scope.checkAlerts($scope._agent.id)
				.then((data) => {
					$scope.results = data;
					$scope.loading = false;
				});

				apiReq.request('GET', `/syscheck/${agent.id}/last_scan`, {})
				.then((data) => {
					$scope.agentInfo.syscheck          = data.data.data;
					$scope.agentInfo.syscheck.duration = "Unknown";
					if (!$scope.agentInfo.syscheck.end && !$scope.agentInfo.syscheck.start) {
						let syscheckTime    = new Date($scope.agentInfo.syscheck.start);
						let syscheckEndTime = new Date($scope.agentInfo.syscheck.end);
						let minutes         = ((syscheckEndTime - syscheckTime) / 1000) / 60;
						$scope.agentInfo.syscheck.duration = window.Math.round(minutes);
					} else if (!$scope.agentInfo.syscheck.end) {
						$scope.agentInfo.syscheck.end = "Unknown";
					} else {
						$scope.agentInfo.syscheck.start = "Unknown";
					}
				})
				.catch((err) => printError(err));

				// Get rootcheck info
				apiReq.request('GET', `/rootcheck/${agent.id}/last_scan`, {})
				.then((data) => {
					$scope.agentInfo.rootcheck          = data.data.data;
					$scope.agentInfo.rootcheck.duration = "Unknown";
					if ($scope.agentInfo.rootcheck.end && $scope.agentInfo.rootcheck.start) {
						let rootcheckTime    = new Date($scope.agentInfo.rootcheck.start);
						let rootcheckEndTime = new Date($scope.agentInfo.rootcheck.end);
						let minutes          = ((rootcheckEndTime - rootcheckTime) / 1000) / 60;
						$scope.agentInfo.rootcheck.duration = window.Math.round(minutes);
					} else if ($scope.agentInfo.rootcheck.end) {
						$scope.agentInfo.rootcheck.end = "Unknown";
					} else {
						$scope.agentInfo.rootcheck.start = "Unknown";
					}
				})
				.catch((err) => printError(err));
			})
			.catch((err) => printError(err));
		}
	};

	// Copy agent from groups tab
	if($rootScope.comeFromGroups){
		let tmpAgent = Object.assign($rootScope.comeFromGroups);
		delete $rootScope.comeFromGroups;
		$scope.applyAgent(tmpAgent);
	}


	// Watchers
	$scope.$watch('tabView', () => $location.search('tabView', $scope.tabView));

	// Watch for timefilter changes
	$scope.$on('$routeUpdate', () => {
		if ($location.search()._g && $location.search()._g !== '()') {
			let currentTimeFilter = rison.decode($location.search()._g);
			// Check if timefilter has changed and update values
			let gParameter;

			if ($route.current.params._g.startsWith("h@")) {
				gParameter = sessionStorage.getItem($route.current.params._g);
			} else {
				gParameter = $route.current.params._g;
			}

			if (gParameter != "()" && (
				$scope.timeGTE != currentTimeFilter.time.from || 
				$scope.timeLT != currentTimeFilter.time.to)
			) {
				$scope.timeGTE = currentTimeFilter.time.from;
				$scope.timeLT  = currentTimeFilter.time.to;

				//Check for present data for the selected tab
				if ($scope.tab !== "preview") {
					if(!('_agent' in $scope)){
						console.log('Waiting for an agent...');
					} else {
						$scope.checkAlerts($scope._agent.id)
						.then((data) => $scope.results = data)
						.catch(() => $scope.results = false);
					}
				}
			}
		}
		// Check if tab is empty, then reset to preview
		if (typeof $location.search().tab === 'undefined' && 
			typeof $location.search().id === 'undefined') {

			$scope.tab = "preview";
			delete $scope._agent;
			$scope.search = "";
		}
	});

	//Load
	try {
		$scope.agentsAutoComplete.nextPage('')
		.then(() => $scope.loading = false);
	} catch (e) {
		notify.error('Unexpected exception loading controller');
	}

	//Destroy
	$scope.$on("$destroy", () => $scope.agentsAutoComplete.reset());


});

app.controller('agentsOverviewController', function ($scope) {});

app.controller('fimController', ($scope) =>	$scope._fimEvent = 'all');

app.controller('pmController', function ($scope) {});

app.controller('auditController', function ($scope) {});

app.controller('oscapController', function ($scope) {});

app.controller('PCIController', function ($scope, genericReq) {
	let tabs = [];
	genericReq.request('GET', '/api/wazuh-api/pci/all')
		.then((data) => {
			angular.forEach(data.data, (value, key) => {
				tabs.push({
					"title": key,
					"content": value
				});
			});
		});

	$scope.tabs 		 = tabs;
	$scope.selectedIndex = 0;

	$scope.addTab = (title, view) => {
		view = view || title + " Content View";
		tabs.push({
			title:    title,
			content:  view,
			disabled: false
		});
	};

	$scope.removeTab = (tab) => {
		let index = tabs.indexOf(tab);
		tabs.splice(index, 1);
	};
});