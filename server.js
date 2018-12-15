var $ = require('jquery');
var https = require('https');
var http = require('http');
var path = require('path');
var fs = require('fs');
var formidable = require('formidable');
var async = require('async');
var socketio = require('socket.io');
var express = require('express');
var mysql = require('./connect-mysql.js').mysqlCon;
var wpa_cli = require('wireless-tools/wpa_cli');
var wpa_supplicant = require('wireless-tools/wpa_supplicant');
var latestGithubTag = require("latest-github-tag");
var numControls = 3;
var liquidPID = require('liquid-pid');
var pidController = [];
var app = express();
var server = http.createServer(app);
var io = socketio.listen(server);
io.set('log level', 1);
app.use(express.static(path.resolve(__dirname, 'client')));
var sockets = [];
var updateControlId = 0;
var recipeFileName;
var tempUnits;
var newWriteTableData = {};
var step = {};
var lastStep = null;
var userAck = false;
var endBrewing = false;
var counter = 0;
var brewingActive = false;
var countDownTime = 0;
var timerEnd;
var countDownRemaining = 0;
var days = 0;
var hours = 0;
var minutes = 0;
var seconds = 0;
var previousTime = 0;
var globalSocket;
var paused = false;
var targetTemp = [];
var targetEquip;
var curTargetTemp = [];
var targetTempReached = false;
var activeBrewStateWriteQueue = [];
var resumeBrewing = false;
var activeBrewStateData = null;
var equipSettings = [];
var resumeStepNum = 0;
var pidSettings = [];
var pidFeedBack = [];
var unProcessedItems = [];
var unProcessedItemsBackup;
var kp = [];
var ki = [];
var kd = [];
var pmax = [];
var tempReading = [];
var periodTimer = [];
var offTimer = [];
var newClientConnection = false;
var clientReadCurrentState = false;
var chartRefreshInterval = 2000;
var beginEndTimes = [[],[]];
var beginEndTimesBackup = [[],[]];
var sys = require('sys')
var exec = require('child_process').exec;
var child;
var heaterState = [0, 0, 0];
var debugLevel = 0;
var processingSchedule = false;
var initComplete = false;
var new_version;
var disableSensorError = [false,false,false];
brewScheduleLoaded = false;

function checkVersion(){
	var current_version = require('./package.json');
	latestGithubTag('Cohbra11', 'Brew-Control-2', {
		timeout: 0,
	}).then(function (new_version) {
		console.log(new_version) // Outputs the latest new_version 
		var versions = {
			"cur_version": current_version.version,
			"new_version": new_version
		};
		globalSocket.emit("versions", versions);	})
	.catch(function (err) {
		console.error(err)
	})

}

function initializeEquip(numControls) {
	
	for (var i = 0; i < numControls; i++) { //initialize the arrays for the pid controller
		targetTemp[i] = 0;
		equipSettings[i] = 0;
		pidFeedBack[i] = 0;
		kp[i] = 25;
		ki[i] = 1000;
		kd[i] = 9;
		pmax[i] = 4000;
		//pid[i] = new PID_Controller(0.25, 0.1, 0.1, 1); // k_p, k_i, k_d, dt 

		pidController[i] = new liquidPID({
			temp: {
				ref: targetTemp[i] // Point temperature                                       
			},
			Pmax: pmax[i], // Max power (output),

			// Tune the PID Controller
			Kp: kp[i], // PID: Kp
			Ki: ki[i], // PID: Ki
			Kd: kd[i] // PID: Kd
		});
	}
	readActiveBrewState();	
	return true;
}
initializeEquip(numControls);

initDbTables(2,
	initDbTables(1,
		initDbTables(0)
	)
);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
	res.sendFile(path.join(__dirname, 'client/index.html'));
});

app.post('/upload', function(req, res) {
	// create an incoming form object
	var form = new formidable.IncomingForm();
	// specify that we want to allow the user to upload multiple files in a single request
	form.multiples = true;
	// store all uploads in the /uploads directory
	form.uploadDir = path.join(__dirname, '/recipes');
	// every time a file has been uploaded successfully,
	// rename it to it's orignal name
	form.on('file', function(field, file) {
		fs.rename(file.path, path.join(form.uploadDir, file.name));
	});
	// log any errors that occur
	form.on('error', function(err) {
		console.log('An error has occured: \n' + err);
	});
	// once all the files have been uploaded, send a response to the client
	form.on('end', function() {
		res.end('success');
	});
	// parse the incoming request containing the form data
	form.parse(req);
});

io.on('connection', function(socket) {
	console.log("Connected");
	getRecipeList();

	sockets.push(socket);
	globalSocket = socket;
	checkVersion();

	socket.on('disconnect', function() {
		sockets.splice(sockets.indexOf(socket), 1);
	});

	socket.on('newTableData', function(writeTableData) {
		var equipID = (writeTableData.tableName).match("control(.*)_temp")[1]; 
		if (writeTableData.setPoint != undefined) {
			newWriteTableData = writeTableData;
			var setTemperature = {
				equipid: equipID,
				temp: writeTableData.setPoint + tempUnits
			};
			setTemp(setTemperature);
		}
	});

	socket.on('getSettings', function(chartID) {
		getSettings(chartID);
	});

	socket.on('power off', function(data) {
		console.log('Shutting Down Brew Controller Server.');
		child = exec("shutdown -P", function(error, stdout, stderr) {});
	});

	socket.on('restart', function(data) {
		restart();
	});

	socket.on('install_update', function() {
		console.log('Installing software updates');
		child = exec("git pull origin master", function(error, stdout, stderr) {
			var fileName = 'package.json';
			var packageData = JSON.parse(fs.readFileSync(fileName, 'utf8'));
			if (packageData != null) {
				console.log("Writing version "+new_version+" to package.json");
				packageData.version = new_version;
				fs.writeFileSync(fileName, JSON.stringify(packageData, null, 2), 'utf8', function(err) {
					if (err) {
						return console.log(err);
					} else {
						restart();
					}
				});
			}
		});
	});

	socket.on('checkWifiConfig', function(data) {
		console.log('Checking wifi configuration for '+data.ssid+'.');
		readWpaSupplicantConf();
	});
	
	function restart(){
		console.log('Restarting the Brew Controller Server.');
		child = exec("shutdown -r", function(error, stdout, stderr) {});
	}
	
	function encodePassphrase(passphrase){
		var hex, i;
		var result = "";
		for (i=0; i<passphrase.length; i++) {
			hex = passphrase.charCodeAt(i).toString(16);
			result += ("000"+hex).slice(-4);
		}
		return result
	}
	
	socket.on('WriteWifiConfig', function(data) {
		filename = "/var/lib/connman/"+data.ssid+".conf"
		child = exec("touch "+filename,
			function (error, stdout, stderr) {
				if (error !== null) {
					console.log('exec error: ' + error);
				}
				child = exec("echo '[service_"+data.ssid+"]' > "+filename,
					function (error, stdout, stderr) {
						if (error !== null) {
							console.log('exec error: ' + error);
						}
						child = exec("echo 'Type = wifi' >> "+filename,
							function (error, stdout, stderr) {
								if (error !== null) {
									console.log('exec error: ' + error);
								}
								child = exec("echo 'Name = "+data.ssid+"' >> "+filename,
									function (error, stdout, stderr) {
										if (error !== null) {
											console.log('exec error: ' + error);
										}
										child = exec("echo 'ssid = "+data.ssid+"' >> "+filename,
											function (error, stdout, stderr) {
												if (error !== null) {
													console.log('exec error: ' + error);
												}
												//child = exec("echo 'Passphrase = "+encodePassphrase(data.pass)+"' >> "+filename,
												child = exec("echo 'Passphrase = "+data.pass+"' >> "+filename,
													function (error, stdout, stderr) {
														if (error !== null) {
															console.log('exec error: ' + error);
														}
														if (data.dhcp=="true"){
															child = exec("echo 'IPv4 = dhcp' >> "+ filename,
																function (error, stdout, stderr) {
																	if (error !== null) {
																		console.log('exec error: ' + error);
																	}
																	connectToWifi(data);
																}
															);
														} else { 
															child = exec("echo 'IPv4 = "+data.ip+"/"+data.subnet+"/"+data.gateway+"' >> "+filename,
																function (error, stdout, stderr) {
																	if (error !== null) {
																		console.log('exec error: ' + error);
																	}
																	connectToWifi(data);
																}
															);
														}												
													}
												);
											}
										);
									}
								);
							}
						);
					}
				);
			}
		);

		
		// console.log(data);
		// var configFileContent = [];
		// configFileContent.push("[service_"+data.ssid+"]");
		// configFileContent.push("    Type = wifi");
		// configFileContent.push("    Name = "+data.ssid);
		// configFileContent.push("    Passphrase = "+data.pass);
		// if (data.dhcp=="true"){
			// configFileContent.push("    IPv4 = dhcp");
		// } else {
			// configFileContent.push("    IPv4 = "+data.ip+"/"+data.subnet+"/"+data.gateway);
		// }
		// for(j=0; j< configFileContent.length; j++){
			// console.log(configFileContent);
		//}
		
	});
	
	socket.on('connectToWifi', function(network) {
		console.log("Connecting to WIFI");
		console.log(JSON.stringify(network));
		connectToWifi(network);
	});

	socket.on('SearchWifi', function(data) {
		console.log('Searching for available Wifi Networks');
		wpa_cli.scan('wlan0', function(err, data){
			wpa_cli.scan_results('wlan0', function(err, scanResults) {
				wpa_cli.status('wlan0', function(err, data) {
					//readWpaSupplicantConf(function(wpaData){
						//console.log('wpaData: '+JSON.stringify(wpaData));
						var connData = {
							status: data,
							results: scanResults
						}
						//console.log(JSON.stringify(connData));
						globalSocket.emit("networkStatus", connData);
					//});
				});
			});
		});
	});

	socket.on('tempUnits', function(tempunits) {
		tempUnits = tempunits;
		updateSettings('tempUnits', tempunits);
	});
	socket.on('weightUnits', function(weightUnits) {
		updateSettings('weightUnits', weightUnits);
	});
	socket.on('volumeUnits', function(volumeUnits) {
		updateSettings('volumeUnits', volumeUnits);
	});
	socket.on('chart0name', function(data) {
		updateEquipment('chartID', 0, 'chart_name', data);
	});
	socket.on('chart1name', function(data) {
		updateEquipment('chartID', 1, 'chart_name', data);
	});
	socket.on('chart2name', function(data) {
		updateEquipment('chartID', 2, 'chart_name', data);
	});
	socket.on('mashProcess', function(data) {
		updateEquipment('process', 'selectEquipMashTemp', 'chartID', data);
	});
	socket.on('infusionProcess', function(data) {
		updateEquipment('process', 'selectEquipMashInfusion', 'chartID', data);
	});
	socket.on('decoctionProcess', function(data) {
		updateEquipment('process', 'selectEquipMashDecoction', 'chartID', data);
	});
	socket.on('boilProcess', function(data) {
		updateEquipment('process', 'selectEquipBoil', 'chartID', data);
	});
	socket.on('setChart0Heater', function(data) {
		writeChartSettings('0', 'heaterID', data);
		activeBrewState("chart0heater", data);
	});
	socket.on('setChart1Heater', function(data) {
		writeChartSettings('1', 'heaterID', data);
		activeBrewState("chart1heater", data);
	});
	socket.on('setChart2Heater', function(data) {
		writeChartSettings('2', 'heaterID', data);
		activeBrewState("chart2heater", data);
	});
	socket.on('setChart0Sensor', function(data) {
		writeChartSettings('0', 'sensorID', data);
		activeBrewState("chart0sensor", data);
	});
	socket.on('setChart1Sensor', function(data) {
		writeChartSettings('1', 'sensorID', data);
		activeBrewState("chart1sensor", data);
	});
	socket.on('setChart2Sensor', function(data) {
		writeChartSettings('2', 'sensorID', data);
		activeBrewState("chart2sensor", data);
	});
	socket.on('setChart0Watts', function(data) {
		writeChartSettings('0', 'heater_watts', data);
		activeBrewState("chart0watts", data);
		pidController[0]._Pmax = parseInt(data, 10);
	});
	socket.on('setChart1Watts', function(data) {
		writeChartSettings('1', 'heater_watts', data);
		activeBrewState("chart1watts", data);
		pidController[1]._Pmax = parseInt(data, 10);
	});
	socket.on('setChart2Watts', function(data) {
		writeChartSettings('2', 'heater_watts', data);
		activeBrewState("chart2watts", data);
		pidController[2]._Pmax = parseInt(data, 10);
	});
	socket.on('setChart0P', function(data) {
		writeChartSettings('0', 'heater_p', data);
		activeBrewState("chart0p", data);
		pidController[0]._Kp = parseInt(data, 10);
	});
	socket.on('setChart1P', function(data) {
		writeChartSettings('1', 'heater_p', data);
		activeBrewState("chart1p", data);
		pidController[1]._Kp = parseInt(data, 10);
	});
	socket.on('setChart2P', function(data) {
		writeChartSettings('2', 'heater_p', data);
		activeBrewState("chart2p", data);
		pidController[2]._Kp = parseInt(data, 10);
	});
	socket.on('setChart0I', function(data) {
		writeChartSettings('0', 'heater_i', data);
		activeBrewState("chart0i", data);
		pidController[0]._Ki = parseInt(data, 10);
	});
	socket.on('setChart1I', function(data) {
		writeChartSettings('1', 'heater_i', data);
		activeBrewState("chart1i", data);
		pidController[1]._Ki = parseInt(data, 10);
	});
	socket.on('setChart2I', function(data) {
		writeChartSettings('2', 'heater_i', data);
		activeBrewState("chart2i", data);
		pidController[2]._Ki = parseInt(data, 10);
	});
	socket.on('setChart0D', function(data) {
		writeChartSettings('0', 'heater_d', data);
		activeBrewState("chart0d", data);
		pidController[0]._Kd = parseInt(data, 10);
	});
	socket.on('setChart1D', function(data) {
		writeChartSettings('1', 'heater_d', data);
		activeBrewState("chart1d", data);
		pidController[1]._Kd = parseInt(data, 10);
	});
	socket.on('setChart2D', function(data) {
		writeChartSettings('2', 'heater_d', data);
		activeBrewState("chart2d", data);
		pidController[2]._Kd = parseInt(data, 10);
	});

	socket.on('selectEquipMashTemp', function(selectEquipMashTemp) {
		updateSettings('selectEquipMashTemp', selectEquipMashTemp);
	});
	socket.on('selectEquipMashInfusion', function(selectEquipMashInfusion) {
		updateSettings('selectEquipMashInfusion', selectEquipMashInfusion);
	});
	socket.on('selectEquipMashDecoction', function(selectEquipMashDecoction) {
		updateSettings('selectEquipMashDecoction', selectEquipMashDecoction);
	});
	socket.on('selectEquipBoil', function(selectEquipBoil) {
		updateSettings('selectEquipBoil', selectEquipBoil);
	});

	socket.on('boilTemperature', function(boilTemperature) {
		updateSettings('boilTemperature', boilTemperature);
	});

	socket.on('heartbeat', function(heartBeatID) {
		socket.emit("heartbeat", heartBeatID + 1);
	});

	socket.on('getTimeSpan', function(chartID) {
		getTimeSpan(chartID);
	});

	socket.on('getTempSetpoint', function(chartname) {
		var table = chartname.replace(/chart/, "");
		var temp;
		try {
			temp = equipSettings[parseInt(table, 10)].temp
		} catch (err) {
			temp = 0;
			equipSettings = [0, 0, 0];
		}
		socket.emit("chartSetPoint", chartname, temp);
	});

	socket.on('newRecipeUploaded', function() {
		getRecipeList();
	});

	socket.on('checkActiveBrewState', function() {
		brewScheduleLoaded = false;
		clientReadCurrentState = true;
		if (debugLevel > 0) {console.log('Client Request Active Brew State.');};
		readActiveBrewState();
	});

	socket.on('brewSchedule', function(data) {
		brewSchedule = data[0].slice();
		unProcessedItems = data[1].slice();
		unProcessedItemsBackup = unProcessedItems.slice();
		// console.log('unProcessedItemsBackup: '+JSON.stringify(unProcessedItemsBackup));
		var fileName = './client/jsonFiles/brewSchedule.json';
		fs.writeFileSync(fileName, JSON.stringify(brewSchedule, null, 2), 'utf8', function(err) { //write the data to the json file
			if (err) {
				return console.log("Error writing file: " + err);
			} else {
				fs.truncate(fileName, 0, function() {
					fs.writeFileSync(fileName, "[]", 'utf8', function(err) { //empty the json file
						if (err) {
							return console.log("Error writing file: " + err);
						}
					})
				})
			}
		})
		brewScheduleLoaded = true;
		// console.log("|||||||||||||||||||||||||||||||Processing Brew Schedule from: socket.on('brewSchedule')||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||");
		if (activeBrewStateData.brewingActive == false){
			processingSchedule = true;
			processBrewSchedule();
		}
	});

	socket.on('recipe', function(recipe) {
		recipeFileName = String(recipe);

		if (recipeFileName != 'none') {
			var recipeFile = require('./loadXMLrecipe.js');
			var changeActiveRecipe = new recipeFile();
			changeActiveRecipe.getResults(socket, recipeFileName);
		} else {
			//------updateBrewSchedule();
			updateSettings('recipe', recipeFileName);
		}
		updateSettings('recipe', recipeFileName);
		activeBrewState('recipe',recipeFileName.replace(/.xml/, ""));
		recipeFileName = null;
	});

	socket.on('mashProfile', function(mash) {
		updateSettings('mashProfile', mash);
	});

	socket.on('setTemperature', function(setTemperature) {
		//console.log("setTemperature: "+setTemperature.temp);
		setTemp(setTemperature);
	});

	socket.on('saveTimeSpan', function(timeSpanData) {
		//console.log("saveTimeSpan: "+timeSpanData);
		setTimespan(timeSpanData.chart, timeSpanData.timespan);
	});

	socket.on('equipmentName', function(data) {
		updateSettings(data.name, data.equip);
	});

	socket.on('userAcknowledged', function(stepNum) {
		//console.log('userAcknowledged');
		endStep();
		userAck = false;
	});

	socket.on('endThisStep', function(stepNum) {
		//console.log('endThisStep');
		endStep();
		userAck = false;
		previousTime == 0;
		globalSocket.emit("countDownTimer", "00:00:00");
	});

	socket.on('Start Brewing', function() {
		if (processingSchedule == true || brewScheduleLoaded == false){
			delayBeginBrewingRequest();
		} else {
			processingSchedule = true;
			beginBrewing();
		}
	});

	socket.on('End Brewing', function() {
		activeBrewState("brewingActive",false);
		newClientConnection == false;
		var datetime = new Date();
		previousTime == 0;
		countDownTime = 0;
		endBrewing = true;
	});

	socket.on('Pause Brewing', function(state) {
		paused = state;
		activeBrewState("paused", state);
	});

	socket.on('step-forward', function(state) {
		if (step.wait == "TEMP" && targetTempReached == false) {
			targetTempReached = true;
		}
		endStep();
	});

	socket.on('step-backward', function(state) {
		getPreviousStep();
	});

	socket.on('resumeBrewing', function() {
		if (processingSchedule == true || brewScheduleLoaded == false){
			delayResumeBrewingRequest();
		} else {
			processingSchedule = true;
			resumePreviousBrewCycle();
		}
	});
	
	function delayResumeBrewingRequest(){
		if (processingSchedule == true || brewScheduleLoaded == false){
			setTimeout(function(){delayResumeBrewingRequest();}, 250);
		} else {
			processingSchedule = true;
			resumePreviousBrewCycle();
		}
	}
	function delayBeginBrewingRequest(){
		if (processingSchedule == true || brewScheduleLoaded == false){
			setTimeout(function(){delayBeginBrewingRequest();}, 250);
		} else {
			processingSchedule = true;
			beginBrewing();
		}
	}
	function delayBrewScheduleRequest(){
		if (activeBrewStateData.brewingActive == true && resumeBrewing == false){
			setTimeout(function(){delayBrewScheduleRequest();}, 250);
		} else {
			processingSchedule = true;
			processBrewSchedule();
		}
	}
});

//server.listen(process.env.PORT || 8080, process.env.IP || "0.0.0.0", function() {
 server.listen(80, function() {
	var addr = server.address();
	console.log("Brew Controller server listening at", JSON.stringify(addr) + ":" + addr.port);
});

var start = Date.now();
setInterval(function() {
    var delta = Date.now() - start; // milliseconds elapsed since start
	update();
}, 1000 / numControls); // update about every second

function update(){
	var updateTable = require('./updateTable.js');
	var updateTableInstance = new updateTable();
	var newTableData = {};
	if (activeBrewStateData != null) {
		switch (updateControlId) { // Get the temperature sensor & heater assignment for the specified targetChart
			case 0:
				var targetSensor = activeBrewStateData.chart0sensor;
				break;
			case 1:
				targetSensor = activeBrewStateData.chart1sensor;
				break;
			case 2:
				targetSensor = activeBrewStateData.chart2sensor;
				break;
			default:
				return;
		}
		
		readSensor(updateControlId, +targetSensor, function(callback) {
			pidControl(updateControlId, function(callback) {
				if (tempUnits != undefined) {
					updateTableInstance.getResults(updateControlId, tempUnits, tempReading[updateControlId], equipSettings[updateControlId].temp);
		if (activeBrewStateData.brewingActive == true) {			
			if (step.ack != undefined){
				if (step.ack != "TRUE"){
					if (step.wait != "TEMP") {
						if ((paused == false) || (paused == undefined)) {
							countDownTimer();
						}
					} else if (step.wait == "TEMP") {
						if (Math.abs(equipSettings[updateControlId].temp - tempReading[updateControlId]) < 1.5) {
							targetTempReached = true;
							activeBrewState("targetTempReached", targetTempReached);
							endStep();
						}
					}
				}
			}
		}		}	
			});
		});
	}
	// Check if we need to reset the control id and start over
	if (updateControlId < numControls - 1) {
		updateControlId++;
	} else {
		updateControlId = 0; // Reset the control id to start over
		if (activeBrewStateData.brewingActive == true) {
			////console.log("step.step "+step.step);
			////console.log("step.wait "+step.wait);
			var timeStamp = new Date();
			//activeBrewState("timeStamp", timeStamp);
			//if (step.ack != undefined){
			//	if (step.ack != "TRUE"){
			//		if (step.wait != "TEMP") {
			//			if ((paused == false) || (paused == undefined)) {
			//				countDownTimer();
			//			}
			//		}
			//	} else if (step.wait == "TEMP") {
			//		//if (Math.abs(equipSettings[targetEquip].temp - curTargetTemp[targetEquip]) < 1.5) {
			//		if (Math.abs(equipSettings[updateControlId].temp - curTargetTemp[updateControlId]) < 1.5) {
			//			console.log("equipSettings[updateControlId].temp = "+equipSettings[updateControlId].temp);
			//			console.log("curTargetTemp[updateControlId] = "+equipSettings[updateControlId].temp);
			//			console.log("targetSensor = "+targetSensor);
			//			targetTempReached = true;
			//			activeBrewState("targetTempReached", targetTempReached);
			//			endStep();
			//		}
			//	}
			//}
		} else {
			previousTime == 0;
		}
	}
	
	if (endBrewing) {
		// turn off all heating elements
		for (var i = 0; i < numControls; i++) { 
			var setTemperature = { 
				"equipid": i,
				"temp": 0,
				"units": tempUnits
			};
			if (typeof setTemperature === 'object') {
				var testVal = setTemperature.temp;
				if (!isNaN(testVal)) {
					setTemp(setTemperature);
				}
			}
		}
		previousTime = 0;
		countDownTime = 0;
		activeBrewState(["brewingActive","paused","previousTime","step","countDownTime"],[false,false,previousTime,{},countDownTime]);
		resumeBrewing = false;
		endBrewing = false;
	}
}

function terminal(command, callback){
	exec(command, function(error, stdout, stderr){ callback(stdout); });
};

function readWpaSupplicantConf(callback){
	var networks = [];
	var rxp = /{([^}]+)}/g;
	var curMatch;
	var commandString = 'cat /etc/wpa_supplicant/wpa_supplicant.conf';
	exec(commandString, function(error, stdout, stderr){
		if (error !== null) {
			console.log('exec error: ' + error);
		}
		while( curMatch = rxp.exec( stdout ) ) {
			networks.push(
				JSON.parse(
					String(
						String(
							String(
								String(
									String(
										String(
											String(
												String(
													curMatch[1]
												).replace(/\n?\t/g,"\",\"")
											).replace(/=/g, "\":\"")
										).replace(/\n/g, "\"}")
									).replace(/(^.)/, "{")
								).replace(/(,$)/g, "}")
							).replace(/(^\",)/, "")
						).replace(/\"\"/g, "\"")
					).replace(/(^\{,)/, "{")
				)
			);
		}
		console.log("WIFI Cfg Data: " + JSON.stringify(networks));
		globalSocket.emit("wifiConfigData", networks);
	});
};

function connectToWifi(connectTo){
	var configExists = false;
	console.log('Connecting to wifi: ' + connectTo.ssid);
	var networks = [];
	var networkID = "";
	child = exec("wpa_cli list_network wlan0", function(error, stdout, stderr) {
		if (error !== null) {
			console.log('exec error: ' + error);
		}
		var dataString = String(stdout).split("\n");
		var data = [];
		console.log("dataString.length: "+dataString.length);
		for(i=2; i<=dataString.length; i++){
			if(i<dataString.length){
				var networkData = {
					id: (String(dataString[i]).split("\t"))[0],
					ssid: (String(dataString[i]).split("\t"))[1],
					bssid: (String(dataString[i]).split("\t"))[2],
					flags: (String(dataString[i]).split("\t"))[3]
				}
				console.log("networkData.ssid: "+networkData.ssid);
				console.log("connectTo.ssid: "+connectTo.ssid);
				if(connectTo.ssid == networkData.ssid){
					configExists = true;
					console.log('Found connection configuration data for '+connectTo.ssid);
					networkID = networkData.id;
					console.log("networkData.id: "+networkData.id);
					wpa_cli.enable_network('wlan0', networkID, function(err, data){
						if (err) {
							console.log(err);
						} else {
							console.log(data);
							wpa_cli.select_network('wlan0', networkID, function(err, data){
								if (err) {
									console.log(err);
								} else {
									child = exec("ip addr flush dev wlan0", function(error, stdout, stderr) {
										if (error !== null) {
											console.log('exec error: ' + error);
										} else {
											if(connectTo.dhcp == "true"){
												child = exec("dhclient", function(error, stdout, stderr) {
													if (error !== null) {
														console.log('exec error: ' + error);
													}
													console.log("Wifi Connected");
													return;
												});
											} else {
												//Add connection steps for static IP here:
												return;
											}
										}
									});
								}
							});	
						}
					});	
				}
			} else {
				//If we get here it is because there isn't any configuration for the selected network > save configuration data to file
				if(i==dataString.length && configExists==false){
					console.log('Could not find connection configuration data for '+connectTo.ssid+', writing configuration.' );
					console.log('configuring network connection for ssid: '+connectTo.ssid);
					wpa_cli.add_network('wlan0', function(err, networkID){
						if (err) {
							console.log(err);
						} else {
							console.log("creating network connection ID: "+networkID.result);
							var ssid = "\'\""+connectTo.ssid+"\"\'";
							console.log("SSID: "+ssid);
							wpa_cli.set_network('wlan0', networkID.result, 'ssid', ssid, function(err, result){
								if (err) {
									console.log(err);
								} else {
									console.log("Writing SSID " + connectTo.ssid + ' to network connection number ' + parseInt(networkID.result) + ': ' + result.result);
									console.log("Encrypted: " + connectTo.encrypted);
									if (connectTo.encrypted){
										var psk = "\'\""+connectTo.pass+"\"\'";
										//wpa_cli.set_network('wlan0', networkID.result, "psk", psk, function(err, result){
										child = exec("wpa_cli set_network " + networkID.result + " psk " + psk, function(error, stdout, stderr) {
											if (error !== null) {
												console.log('exec error: ' + error);
											}
											//if (err) {
											//	console.log(err);
											//} else {
												console.log("Writing password " + connectTo.pass + ' to network connection number ' + parseInt(networkID.result) + ': ' + result.result);
												wpa_cli.save_config('wlan0', function(err, result){
													if (err) {
														console.log(err);
													} else {
														console.log("Saving wpa_supplicant.conf to /etc/wpa_supplicant/: " + result.result);
														child = exec("wpa_cli reconfigure", function(error, stdout, stderr) {
															if (error !== null) {
																console.log('exec error: ' + error);
															}
															connectToWifi(connectTo);
															return;
														});
													}
												});
											//}
										});
									} else {
										console.log("key_mgmt: " + "NONE");
										//wpa_cli.set_network(networkID.result, "key_mgmt", "NONE", function(err, result){
										child = exec("wpa_cli set_network " + networkID.result + " key_mgmt NONE", function(error, stdout, stderr) {
											//console.log("Result: " + result);
											//if (err) {
											//	console.log(err);
											//} else {
											if (error !== null) {
												console.log('Exec ' + error);
											}	
											console.log("Saving...");
											child = exec("wpa_cli save_config wlan0", function(error, stdout, stderr) {
											//wpa_cli.save_config('wlan0', function(err, result){
												//console.log("Result: " + result);
												//if (err) {
												//	console.log(err);
												//} else {
												if (error !== null) {
													console.log('Exec ' + error);
												}
												console.log("Saving wpa_supplicant.conf to /etc/wpa_supplicant/: " + result.result);
												child = exec("wpa_cli reconfigure", function(error, stdout, stderr) {
													if (error !== null) {
														console.log('exec error: ' + error);
													}
													connectToWifi(connectTo);
													return;
												});
												//}
											});
										
										});
									}
								}
							});
						}
					});
				}			
			}
		}
	});
}	

function getRecipeList(activeBrewStateData) {
	//Load the list of recipes that are saved on the server
	var files = fs.readdirSync('./recipes/');
	var obj = {};
	var new_json;
	obj = {
		"recipe": files
	};
	new_json = JSON.stringify(obj);
	try {
		fs.writeFileSync('client/jsonFiles/recipes.json', new_json, 'utf8', function() {});
		success = true;
	} catch (err) {}
}

function activeBrewState(key, value) {
	if (key.constructor === Array){
		for(var ea = 0; ea < key.length; ea++){
			var data = {
				key: key[ea],
				value: value[ea]
			};
			activeBrewStateWriteQueue.push(data);
		}
	} else {
		var data = {
			key: key,
			value: value
		};
		activeBrewStateWriteQueue.push(data);
	}
	writeActiveBrewState();
}

function writeActiveBrewState() {
	var fileName = './client/jsonFiles/activeBrewState.json';
	var file = require(fileName);
	while (activeBrewStateWriteQueue.length > 0) {
		var newData = activeBrewStateWriteQueue.shift();
		file[newData.key] = newData.value;
		if (debugLevel > 0) {console.log('Writing '+newData.key+': '+JSON.stringify(newData.value)+' to the Active Brew State.');};		
		fs.writeFileSync(fileName, JSON.stringify(file, null, 2), 'utf8', function(err) {
			if (err) return console.log(err);
		});
	}
	if (activeBrewStateWriteQueue.length > 0) {
		if (debugLevel > 0) {console.log('Writing additional data to the Active Brew State');};
		writeActiveBrewState();
	} else {
		readActiveBrewState();		
		return;
	}
}

function readActiveBrewState() {
	var fileName = './client/jsonFiles/activeBrewState.json';
	activeBrewStateData = JSON.parse(fs.readFileSync(fileName, 'utf8'));
	if (activeBrewStateData != null) {
		paused = activeBrewStateData.paused;
		targetTempReached = activeBrewStateData.targetTempReached;
		equipSettings = activeBrewStateData.equipSettings;
		pidSettings = activeBrewStateData.pidSettings;

		if (clientReadCurrentState == true){
			globalSocket.emit("activeBrewState", activeBrewStateData);
			clientReadCurrentState = false;
		}
		return (activeBrewStateData);
	}
}

function initDbTables(y){
	mysql.connect(function(err) {
		var queryString = "SELECT * FROM control"+y+"_temp ORDER BY id DESC LIMIT 1;";
		// var queryString = "DELETE FROM control0_temp WHERE id < (SELECT id FROM control0_temp ORDER BY id DESC LIMIT 180);";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 122");
				throw err;
			} else {
				var timespan = rows[0].timespan;
				var numRows = rows[0].id;
				var rowsToDelete = numRows - timespan;
				queryString= "DELETE FROM control"+y+"_temp WHERE id < "+rowsToDelete+";";
				mysql.query(queryString, function(err, rows) {
					if (err) {
						console.log("Err ID: 122");
						throw err;
					} else {
						queryString= "SELECT id FROM control"+y+"_temp ORDER BY id ASC;";
						mysql.query(queryString, function(err, rows) {
							if (err) {
								console.log("Err ID: 124");
								throw err;
							} else {
								for(var i = 0; i < rows.length; i++){
									queryString= "UPDATE control"+y+"_temp SET id="+i+" WHERE id="+rows[i].id+";";
									mysql.query(queryString, function(err, rows) {
										if (err) {
											console.log("Err ID: 125");
											throw err;
										} else {
										}
									});
								}
								queryString= "ALTER TABLE control"+y+"_temp AUTO_INCREMENT = "+ (+timespan+1) +";";
								mysql.query(queryString, function(err, rows) {
									if (err) {
										console.log("Err ID: 126");
										throw err;
									} else {
										
									}
								});
							}
						});
					}
				});
			}
		});
	});
}

function insertStep(item) {
	// console.log('item: '+JSON.stringify(item));
	var stepString = 'Waiting for ';
	var item2 = item;
	getStepVars(item2, function(stepVars) {
		switch (item.PROCESS) {
			case "BOIL":
				stepString = 'Boiling for ';
				addRelToProcessEnd(item, stepString, stepVars, function(callback) {});
				break;
			case "MASH":
				addRelToProcessEnd(item, stepString, stepVars, function(callback) {});
				break;
			case "FIRST WORT":
				stepString = 'Boiling for ';
				addRelToProcessEnd(item, stepString, stepVars, function(callback) {});
				break;
			case "AROMA":
				stepString = 'Boiling for ';
				addRelToProcessEnd(item, stepString, stepVars, function(callback) {});
				break;
			case "PITCH":
				addRelToProcessEnd(item, stepString, stepVars, function(callback) {});
				break;
			case "SECONDARY":
				addRelToProcessEnd(item, stepString, stepVars, function(callback) {});
				break;
			default:
				return;
		}
	});
}

function getStepVars(item, callback) {
	mysql.connect(function(err) {
		// get the time of the last step in the process
		if (item.PROCESS == "FIRST WORT"){
			var queryString = "SELECT `clock` FROM `brew_schedule` WHERE `process`='BOIL' ORDER BY `id` DESC LIMIT 1;";
		} else {
			var queryString = "SELECT `clock` FROM `brew_schedule` WHERE `process`='" + item.PROCESS + "' ORDER BY `id` DESC LIMIT 1;";
		}
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 115");
				throw err;
			} else {
				if (rows.length < 1) {
					// console.log(item.PROCESS +" does not exist");
					//return;
				}
				var processEndTime = rows[0].clock;
				// console.log('processEndTime: '+processEndTime);
				// get the time of the first step in the process
				if (item.PROCESS == "FIRST WORT"){
					var queryString = "SELECT `clock` FROM `brew_schedule` WHERE `process`='BOIL' ORDER BY `id` ASC LIMIT 1;";
				} else {
					var queryString = "SELECT `clock` FROM `brew_schedule` WHERE `process`='" + item.PROCESS + "' ORDER BY `id` ASC LIMIT 1;";
				}
				mysql.query(queryString, function(err, rows) {
					if (err) {
						console.log("Err ID: 116");
						throw err;
					} else {
						// console.log("Process: "+item.PROCESS);
						// console.log("rows: "+JSON.stringify(rows));
						var processBeginTime = rows[0].clock;
						var insertTime = processEndTime - item.TIME;
						if (insertTime < processBeginTime || item.PROCESS == "FIRST WORT") {
							insertTime == processBeginTime;
							// addToProcessStart(item);
							// return;
						}
						// get the equipment used in the current process
						switch (item.PROCESS) {
							case "BOIL":
								var processName =  "selectEquipBoil";
								break;
							case "MASH":
								processName =  "selectEquipMashTemp";
								break;
							case "FIRST WORT":
								processName =  "selectEquipBoil";
								break;
							case "AROMA":
								processName =  "selectEquipBoil";
								break;
							case "PITCH":
								processName =  "";
								break;
							case "PRIMARY":
								processName =  "";
								break;
							case "SECONDARY":
								processName =  "";
								break;
							case "BOTTLING":
								processName =  "";
								break;
							default:
								return;
						}
						var queryString = "SELECT `chart_name` FROM `equipment` WHERE (`process`='" + processName + "') LIMIT 1";
						mysql.query(queryString, function(err, rows) {
							if (err) {
								console.log("Err ID: 117");
								throw err;
							} else {
								if (rows.length > 0) {
									var equipName = rows[0].chart_name;
								} else {
									equipName = "Undefined Equipment";
								}
								callback({
									processEndTime: processEndTime,
									insertTime: insertTime,
									equipName: equipName
								});
							}
						});
					}
				});
			}
		});
	});
}

function addIngredient(j, record, insertTime, rows, item, equipName, newData, callback) {
	record = { // this record is where we will notify the user to add the ingredient
		STEPNUM: j,
		CLOCK: insertTime,
		TIME: "0",
		PROCESS: rows[j].process,
		INFO: "",
		STEP: "Add " + item.AMOUNT + " of " + item.NAME + " to " + equipName + ".",
		TEMP: "",
		EQUIP: "",
		EQUIPID: "",
		AMOUNT: "",
		ACK: "TRUE",
		WAIT: ""
	};
	newData.unshift(record);
	return (callback);
}

function addStep(j, record, insertTime, rows, item, equipName, newData, callback) {
	var newTime = parseInt(newData[1].CLOCK, 10) - parseInt(newData[0].CLOCK, 10);
	if (newTime > 0) {
		record = { // this record will be the step that we set the timer and wait.
			STEPNUM: j,
			CLOCK: parseInt(newData[1].CLOCK, 10),
			TIME: parseInt(newData[1].CLOCK, 10) - parseInt(newData[0].CLOCK, 10),
			PROCESS: rows[j].process,
			INFO: "",
			STEP: "",
			TEMP: "",
			EQUIP: "",
			EQUIPID: "",
			AMOUNT: "",
			ACK: "FALSE",
			WAIT: "TIME"
		};
		newData.splice(1, 0, record);
		return (callback);
	} else {
		return (callback);
	}
}

function updateClock(j, record, insertTime, rows, item, equipName, newData, callback) {
	if (newData[1] != undefined) {
		var newTime = parseInt(newData[1].CLOCK, 10) - parseInt(newData[0].CLOCK, 10);
		if (newTime == 1) {
			newData[1].STEP = "Waiting for " + newTime + " minute.";
			newData[1].TIME = newTime;
		} else if (newTime > 1) {
			newData[1].STEP = "Waiting for " + newTime + " minutes.";
			newData[1].TIME = newTime;
		}
	}
}

function reInsertRecord(j, record, insertTime, rows, item, equipName, newData, callback) {
	record = { //add in the current record & update tht step number
		STEPNUM: j,
		TIME: rows[j].time,
		CLOCK: rows[j].clock,
		PROCESS: rows[j].process,
		INFO: rows[j].info,
		STEP: rows[j].step,
		TEMP: rows[j].temp,
		EQUIP: rows[j].equip,
		EQUIPID: rows[j].equipid,
		AMOUNT: rows[j].amount,
		ACK: rows[j].ack,
		WAIT: rows[j].wait
	};
	newData.unshift(record);
	return (callback);
}

function addRelToProcessEnd(item, stepString, vars, callback) {
	var processEndTime = vars.processEndTime;
	var insertTime = vars.insertTime;
	var equipName = vars.equipName;

	var targetRecordAdded = false;
	// var equipName;
	var newData = [];
	mysql.connect(function(err) {

		var queryString = "SELECT * FROM `brew_schedule` ORDER BY `id`;";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 118");
				throw err;
			} else {
				var record = {};

				for (var j = rows.length - 1; j >= 0; j--) {
					if (targetRecordAdded == false) {

						//================= Do this if we found the right place to insert the new record=====================//
						if (rows[j].process == item.PROCESS && parseInt(rows[j].clock, 10) <= insertTime) { // if this is the right process, and the step to be added has a time that is less than the current step we're reading, then insert the new step here.
							if (j + 1 != rows.length && rows[j + 1].wait != "TIME") {
								reInsertRecord(j, record, insertTime, rows, item, equipName, newData,
									updateClock(j, record, insertTime, rows, item, equipName, newData,
										addStep(j, record, insertTime, rows, item, equipName, newData,
											addIngredient(j, record, insertTime, rows, item, equipName, newData)
										)
									)
								);
							} else {
								reInsertRecord(j, record, insertTime, rows, item, equipName, newData,
									updateClock(j, record, insertTime, rows, item, equipName, newData,
										addIngredient(j, record, insertTime, rows, item, equipName, newData)
									)
								);
							}
							targetRecordAdded = true;
							//======================= Do this if we're still looking for the right place to insert the new record=====================//
						} else { // shift the data and increment the step number to make space for the new records/steps to be inserted
							if (newData.length > 1) {
								if (newData[1].WAIT != "TIME") {
									reInsertRecord(j, record, insertTime, rows, item, equipName, newData);
								} else {
									reInsertRecord(j, record, insertTime, rows, item, equipName, newData,
										updateClock(j, record, insertTime, rows, item, equipName, newData)
									);
								}
							} else {
								reInsertRecord(j, record, insertTime, rows, item, equipName, newData);
							}
						}
						//================= Do this if we've already inserted the new record=====================//
					} else { // our record has already been added, so just update the rest of the step numbers
						if (newData.length > 1) {
							if (newData[1].WAIT != "TIME") {
								reInsertRecord(j, record, insertTime, rows, item, equipName, newData,
									updateClock(j, record, insertTime, rows, item, equipName, newData,
										addStep(j, record, insertTime, rows, item, equipName, newData)
									)
								);
							} else {
								reInsertRecord(j, record, insertTime, rows, item, equipName, newData);
							}
						} else {
							reInsertRecord(j, record, insertTime, rows, item, equipName, newData);
						}
					}
					if (j == 0) {
						var fileName = './client/jsonFiles/brewSchedule.json';
						if(unProcessedItems.length > 0){
							processMiscItems(
								writeSchedule(
									truncateBrewSchedule(
										fs.writeFileSync(fileName, JSON.stringify(newData, null, 2), 'utf8', function(err) { //write the data to the json file
											if (err) {
												return console.log("Error writing file: " + err);
											} else {
												// console.log("|||||||||||||||||||||||||||||||Updating Brew Schedule from: addRelToProcessEnd()||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||");
												fs.truncate(fileName, 0, function() {
													fs.writeFileSync(fileName, "[]", 'utf8', function(err) { //empty the json file
														if (err) {
															return console.log("Error writing file: " + err);
														}
													})
												})
											}
										})
									)
								)
							);
						} else {
							processingSchedule = false;
							writeSchedule(
								truncateBrewSchedule(
									fs.writeFileSync(fileName, JSON.stringify(newData, null, 2), 'utf8', function(err) { //write the data to the json file
										if (err) {
											return console.log("Error writing file: " + err);
										} else {
											// console.log("|||||||||||||||||||||||||||||||Updating Brew Schedule from: addRelToProcessEnd()||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||");
											fs.truncate(fileName, 0, function() {
												fs.writeFileSync(fileName, "[]", 'utf8', function(err) { //empty the json file
													if (err) {
														return console.log("Error writing file: " + err);
													}
												})
											})
										}
									})
								)
							);
						}
					}
				}
			}
		});
	});
	callback("success");
}

function getTimeSpan(chartID) {
	var gettimespan = require('./getTimeSpan.js');
	var gettimespanInstance = new gettimespan();
	gettimespanInstance.getResults(globalSocket, chartID);
	chartID = null;
}

function setTimespan(chart, timespan) {
	var table = "control" + chart + "_temp";
	mysql.connect(function(err) {
		var queryString = "UPDATE `" + table + "` SET timespan=" + timespan + " ORDER BY id DESC LIMIT 1;";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 112");
				throw err;
			} else {

			}
			return;
		});
		//mysql.end();
	});
}

function getSettings(chartID) {
	mysql.connect(function(err) {
		var queryString = "SELECT chart_name FROM `equipment` WHERE chartID = " + chartID + " LIMIT 1;";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 129");
				throw err;
			} else {
				if (rows.length > 0) {
					var chart_name = rows[0].chart_name;
				} else {
					chart_name = "";
				}
				queryString = "SELECT * FROM `equipment_settings` WHERE chartID = " + chartID + " LIMIT 1;";
				mysql.query(queryString, function(err, rows) {
					if (err) {
						console.log("Err ID: 129.5");
						throw err;
					} else {
						var data = {
							chart_name: chart_name,
							sensorID: rows[0].sensorID,
							heaterID: rows[0].heaterID,
							heater_watts: rows[0].heater_watts,
							heater_p: rows[0].heater_p,
							heater_i: rows[0].heater_i,
							heater_d: rows[0].heater_d
						}

						globalSocket.emit("settings", data);
					}
					return;
				});
			}
			return;
		});
	});
};

function adjustTempOutput(pidFeedBack, targetChart, callback) {
	var period = 500;
	if (activeBrewStateData != null) {
		switch (targetChart) { // Get the temperature sensor & heater assignment for the specified targetChart
			case 0:
				var targetHeater = parseInt(activeBrewStateData.chart0heater, 10);
				// console.log("targetHeater: "+targetHeater);
				break;
			case 1:
				targetHeater = parseInt(activeBrewStateData.chart1heater, 10);
				break;
			case 2:
				targetHeater = parseInt(activeBrewStateData.chart2heater, 10);
				break;
			default:
				return;
		}
	}
	switch (targetHeater) { // Get the GPIO pin that is assigned to the targetChart
		case 1:
			var gpio = 60;
			break;
		case 2:
			gpio = 50;
			break;
		case 3:
			gpio = 51;
			break;
		default:
			return;
	}
	// console.log("gpio: "+gpio);
	if(targetChart == 0){
	}
	// console.log("pidFeedBack: "+pidFeedBack > 0);
	if (pidFeedBack > 0) {
		// console.log("set chart "+targetChart+" heater to: 1");
		child = exec("echo 1 > /sys/class/gpio/gpio" + gpio + "/value", function(error, stdout, stderr) {
			if (error !== null) {
				console.log('exec error: ' + error);
			}
		});
	} else {
		// console.log("set chart "+targetChart+" heater to: 0");
		child = exec("echo 0 > /sys/class/gpio/gpio" + gpio + "/value", function(error, stdout, stderr) {
			if (error !== null) {
				console.log('exec error: ' + error);
			}
		});
	}
	if (pidFeedBack < pmax[targetChart]) {
		offTimer[targetChart] = setTimeout(function() {
			// console.log("set chart "+targetChart+" heater to: 0");
			child = exec("echo 0 > /sys/class/gpio/gpio" + gpio + "/value", function(error, stdout, stderr) {
				if (error !== null) {
					console.log('exec error: ' + error);
				}
			});
		}, pidFeedBack / pmax[targetChart] * 1000);
	}
	return (callback);
}

function readSensor(updateControlId, targetSensor, callback) {
	child = exec("cat temp_sensors/devices/w1_bus_master" + (targetSensor) + "/28-*/w1_slave", function(error, stdout, stderr) {
		tempReading[updateControlId] = parseInt(stdout.substring(stdout.length - 6, stdout.length), 10);
		var sensorID = stdout.substring(0, 26);
		try {
			if (tempUnits.toUpperCase() == "C") {
				tempReading[updateControlId] = tempReading[updateControlId] / 1000;
				//console.log('Sensor '+updateControlId+' '+sensorID+': ' + tempReading[updateControlId] + ' C');
			} else {
				tempReading[updateControlId] = tempReading[updateControlId] / 1000 * 1.8 + 32;
				//console.log('Sensor '+updateControlId+' '+sensorID+': ' + tempReading[updateControlId] + ' F');
			}
			if (error !== null) {
				// console.log(targetSensor);
				//console.log('Exec ' + error);
				if (disableSensorError[updateControlId] == false){
					globalSocket.emit("SensorError", updateControlId);
					disableSensorError[updateControlId] = true;
				}				
			} else {
				if (disableSensorError[updateControlId] == true){		
					globalSocket.emit("SensorConnected", updateControlId);
					disableSensorError[updateControlId] = false;
				}
			}
		} catch (err) {}
	});
	callback(tempReading[targetSensor]);
}

function pidControl(targetChart, callback) {
	try {
		pidController[targetChart].setPoint(equipSettings[targetChart].temp); //Update the chart's temperature setpoint in the PID controller
	} catch (err) {
		console.log("PID Controller Eror")
	}
	if (activeBrewStateData != null) {
		var kp = activeBrewStateData.pidSettings[targetChart]._Kp;
		var ki = activeBrewStateData.pidSettings[targetChart]._Ki;
		var kd = activeBrewStateData.pidSettings[targetChart]._Kd;
	}
	pidController[targetChart].tune(kp, ki, kd); // Update the PID controller settings
	pidFeedBack[targetChart] = pidController[targetChart].calculate(parseFloat(tempReading[targetChart])); // Get the updated feedback from the PID controller based on the most current reading and settings
	//console.log(pidFeedBack[targetChart]);
	var adjustTempResult = adjustTempOutput(pidFeedBack[targetChart], targetChart); // Turn the heater on/off based on the new feedback
	callback(curTargetTemp[targetChart]);

}

function setTemp(setTemperature) {
	if (units == undefined) {
		var units = tempUnits;
	} else {
		units = setTemperature.temp[setTemperature.temp.length - 1];
	}
	var temp = parseFloat(setTemperature.temp);
	equipSettings[setTemperature.equipid] = {
		"equipID": setTemperature.equipid,
		"temp": temp,
		"units": units
	};

	pidController[setTemperature.equipid].setPoint(temp);
	// pid[setTemperature.equipid].setTemp(temp);

	if (resumeBrewing == false) {
		try {
			activeBrewState(["equipSettings","pidSettings"],[equipSettings,pidController]);
		} catch (err) {
			equipSettings = [0, 0, 0];
		}
	}

	if (tempUnits == units) {
		var tempSetPoint = temp;
	} else if (units == "C") {
		tempSetPoint = ((+temp * 10 * 1.8) + 32) / 10;
	} else if (units == "F") {
		tempSetPoint = (((+temp * 10) - 32) / 1.8) / 10;
	}
	//console.log("tempSetPoint: "+tempSetPoint);
	var table = "control" + setTemperature.equipid + "_temp";
	try {
		mysql.connect(function(err) {
			var queryString = "UPDATE `" + table + "` SET `setpoint`=" + tempSetPoint + " ORDER BY `id` DESC LIMIT 1;";
			mysql.query(queryString, function(err, rows) {
				if (err) {
					console.log("queryString: " + queryString);
					console.log("Err ID: 108");
					// throw err;
				} else {

				}
				//mysql.end();
				return;
			});
		});
	} catch (err) {}
}

function updateSettings(setting, value) {
	var fileName = './client/jsonFiles/settings.json';
	var file = require(fileName);
	var backupFile = './client/jsonFiles/settings.json.bak';

	file[setting] = value;
	try {
		fs.writeFileSync(fileName, JSON.stringify(file, null, 2), 'utf8', function(err) {
			if (err) console.log(err);
		});
	} catch (err) { //if error, try to restore the last backup and then update the settings again.
		fs.createReadStream(backupFile).pipe(fs.createWriteStream(fileName));
		updateSettings(setting, value);
	}
	// If we made it this far, the settings were updated, save a fresh backup
	fs.createReadStream(fileName).pipe(fs.createWriteStream(backupFile));
}

function processBrewSchedule() {
	processingSchedule = true;
	// console.log("|||||||||||||||||||||||||||||||Processing Brew Schedule||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||");
	globalSocket.emit('ProcessingBrewSchedule');
	processMiscItems(
		writeSchedule(
			truncateBrewSchedule(
				getBeginEndTimes(beginEndTimes) //just in case there was a previously active brew cycle, get the times.
			)
		)
	);
}

function beginBrewing() {
	// console.log("|||||||||||||||||||||||||||||||Updating Brew Schedule from: beginBrewing()||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||");
	if(clientReadCurrentState == false){
		unProcessedItems = unProcessedItemsBackup.slice();
		var datetime = new Date();
		if (debugLevel > 0) {console.log('Brewing Process Started on ' + datetime + '.');};
		lastStep = null;
		paused = false;
		previousTime = 0;
		resumeBrewing = false;
		newClientConnection = false;
		activeBrewState(["brewingActive","paused","previousTime"],[true,false,0])
		globalSocket.emit('ProcessingBrewSchedule');
		getBrewStep(
			//processMiscItems(
				writeSchedule(
					truncateBrewSchedule(
					)
				)
			//)
		);
	} else {
		setTimeout(function(){beginBrewing();}, 250);
	}
}

function resumePreviousBrewCycle() {
	// console.log("|||||||||||||||||||||||||||||||Resuming Previous Brew Cycle||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||");
	if(clientReadCurrentState == false){
	var now = new Date();
		unProcessedItems = unProcessedItemsBackup.slice();
		beginEndTimes = beginEndTimesBackup.slice();
		resumeBrewing = true;
		globalSocket.emit('ProcessingBrewSchedule');
		getBrewStep(
			updateBeginEndTimes(beginEndTimes)
		);
	} else {
		setTimeout(function(){resumePreviousBrewCycle();}, 250);
	}
}
							
function getBeginEndTimes(beginEndTimes) {
	mysql.connect(function(err) {
		var queryString = "SELECT * FROM `brew_schedule` WHERE `begin_time` IS NOT NULL ORDER BY `id` ASC;";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 119");
				if (debugLevel > 0) {console.log('MySql query string error: '+querystring);};
				return;
			} else {
				var beginTimes = [];
				var endTimes = [];
				for (var j = 0; j < rows.length; j++) {
					beginTimes[j] = rows[j].begin_time;
					endTimes[j] = rows[j].end_time;
					// console.log('beginTime: '+beginTimes[j]);
					// console.log('rows.length: '+rows.length);
					// console.log('j: '+j);
					if (j == +rows.length-1) {
						beginEndTimes = [beginTimes, endTimes];
						beginEndTimesBackup = beginEndTimes.slice();
						// console.log("BeginEndTimes: "+JSON.stringify(beginEndTimes));
					}
				}
			}
		});
	});
}

function truncateBrewSchedule(){
	mysql.connect(function(err) {
		var queryString = "TRUNCATE `brew_schedule`;";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 119");
				if (debugLevel > 0) {console.log('MySql query string error: '+querystring);};
			}
		});
	});
}

function writeSchedule(){
	var fileName = './client/jsonFiles/brewSchedule.json';
	var data = JSON.parse(fs.readFileSync(fileName, 'utf8'));
	if(data){
		if(data != 'none'){
			mysql.connect(function(err){
				for(var i = 0; i < data.length; i++){
					var stepStr = data[i].STEP.replace(/'/,"''");
					var infoStr = data[i].INFO.replace(/'/,"''");
					var equipStr = data[i].EQUIP.replace(/'/,"''");
					var queryString = "INSERT INTO `brew_schedule` (clock, time, process, info, step, temp, equip, equipid, amount, ack, stepnum, wait) VALUES ('"+data[i].CLOCK+"','"+data[i].TIME+"', '"+data[i].PROCESS+"', '"+infoStr+"', '"+stepStr+"', '"+data[i].TEMP+"', '"+equipStr+"', '"+data[i].EQUIPID+"', '"+data[i].AMOUNT+"', '"+data[i].ACK+"', '"+i+"', '"+data[i].WAIT+"')";
					mysql.query(queryString, function(err, result){
						if(err)	{
							console.log("Err ID: 103");
						} else {
							if(unProcessedItems == {}){
								globalSocket.emit('FinishedProcessingBrewSchedule');
								processingSchedule = false;
							}
						}
					});
				}
			});
		}
	}
}

function processMiscItems() {
	if(unProcessedItems.length >=1){
		var item = unProcessedItems.shift();
		 console.log("Processing Unprocessed Misc Item: "+JSON.stringify(item));
		// console.log("Processing Unprocessed Misc Items: "+JSON.stringify(unProcessedItems));
		insertStep(item);
	} else {
		globalSocket.emit('FinishedProcessingBrewSchedule');
		processingSchedule = false;
	}
}

function writeChartSettings(chartID, key1, value1) {
	mysql.connect(function(err) {
		var queryString = "UPDATE equipment_settings SET " + key1 + "='" + value1 + "' WHERE chartID='" + chartID + "';";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log(queryString);
				console.log("Err ID: 132");
				throw err;
			} else {
				//mysql.end();
				return;
			}
		});
	});
}

function updateEquipment(key1, value1, key2, value2) {
	mysql.connect(function(err) {
		//var noInjectValue2 = value2.replace(/'/,"''");
		var queryString = "UPDATE equipment SET " + key2 + "='" + value2.replace(/'/, "''") + "' WHERE " + key1 + "='" + value1 + "';";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log(queryString);
				console.log("Err ID: 133");
				throw err;
			} else {
				return;
			}
		});
	});
}

function updateEquipmentSettings(key1, value1, key2, value2) {
	mysql.connect(function(err) {
		var queryString = "SELECT chartID FROM equipment WHERE " + key1 + "='" + value1 + "' LIMIT 1;";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log(queryString);
				console.log("Err ID: 131");
				throw err;
			} else {
				var queryString = "UPDATE equipment_settings SET " + key2 + "='" + value2 + "' WHERE chartID='" + value1 + "';";
				mysql.query(queryString, function(err, rows) {
					if (err) {
						console.log(queryString);
						console.log("Err ID: 132");
						throw err;
					} else {

						//mysql.end();
						return;
					}
				});
				return;
			}
		});
	});
}

function updateBeginEndTimes(beginEndTimes) {
	mysql.connect(function(err) {
		// console.log('beginEndTimes[0].length: '+beginEndTimes[0].length);
		for (var i = 0; i < beginEndTimes[0].length; i++) {
			if (debugLevel > 0) {console.log('Updating begin/end times from previously completed steps.');};
			var queryString = "REPLACE INTO `brew_schedule` ('begin_time', 'end_time') VALUES ('"+beginEndTimes[0][i]+ "', '"+beginEndTimes[1][i]+"') WHERE `id`='" + (+i+1) + ";";
			mysql.query(queryString, function(err, rows) {
				if (err) {
					console.log("Err ID: 128");
					if (debugLevel > 0) {console.log('MySql query string error: '+queryString);};
						return(err);
				} else {
				}
			});
		}
	});
}

function getBrewStep() {
	if (activeBrewStateData.brewingActive == true && resumeBrewing == false) {
		if (debugLevel > 0) {console.log('Getting Brew Step');};
		targetTempReached = false;
		activeBrewState("targetTempReached", targetTempReached);
	}
	mysql.connect(function(err) {
		if (activeBrewStateData.brewingActive == true && resumeBrewing == true) {
			if (debugLevel > 0) {console.log('Resuming previous brew session');};
			var queryString = "SELECT * FROM `brew_schedule` ORDER BY `id` LIMIT 1 OFFSET " + resumeStepNum + ";";
			globalSocket.emit('FinishedProcessingBrewSchedule');
			processingSchedule = false;
		} else {
			queryString = "SELECT * FROM `brew_schedule` WHERE `end_time` IS NULL ORDER BY `id` ASC LIMIT 1;";
		}
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 104");
				if (debugLevel > 0) {console.log('MySql query string error: '+querystring);};
				return;
			} else {
				if (rows.length > 0) {
					step = {
						"id": rows[0].id,
						"clock": rows[0].clock,
						"time": rows[0].time,
						"process": rows[0].process,
						"info": rows[0].info,
						"step": rows[0].step,
						"temp": rows[0].temp,
						"equip": rows[0].equip,
						"equipid": rows[0].equipid,
						"amount": rows[0].amount,
						"ack": rows[0].ack,
						"stepnum": rows[0].stepnum,
						"wait": rows[0].wait,
						"begin_time": rows[0].begin_time,
						"end_time": rows[0].end_time
					};
					if (debugLevel > 0) {console.log('Got Brew Step: '+step.id);};
					// console.log('resumeBrewing: '+resumeBrewing);
					if (resumeBrewing == false) {
						activeBrewState("step", step);
						processingSchedule = false;
						processStep(step);
					} else {
						processStep(step);
					}
				} else {
					//console.log("Brewing Process Complete");
					globalSocket.emit("brewingComplete");
					activeBrewState("brewingActive", false);
					counter = 0;
					endBrewing = true;
				}
			}
		});
		return;
	});
}

function getPreviousStep() {
	//console.log("Getting Previous Step");
	if (parseInt(step.stepnum, 10) < 1) {
		return;
	} else {
		mysql.connect(function(err) {
			var queryString = "SELECT * FROM `brew_schedule` WHERE `end_time` IS NOT NULL ORDER BY `id` DESC LIMIT 1;";
			mysql.query(queryString, function(err, rows) {
				if (err) {
					console.log("Err ID: 120");
					throw err;
				} else {
					if (rows.length > 0) {
						step = {
							"id": rows[0].id,
							"clock": rows[0].clock,
							"time": rows[0].time,
							"process": rows[0].process,
							"info": rows[0].info,
							"step": rows[0].step,
							"temp": rows[0].temp,
							"equip": rows[0].equip,
							"equipid": rows[0].equipid,
							"amount": rows[0].amount,
							"ack": rows[0].ack,
							"stepnum": rows[0].stepnum,
							"wait": rows[0].wait,
							"begin_time": rows[0].begin_time,
							"end_time": rows[0].end_time
						};
						activeBrewState("step", step);
						processStep(step);
					}
				}
			});
			queryString = "UPDATE `brew_schedule` SET `end_time`= NULL WHERE `id`=" + String(parseInt(step.id, 10) - 1) + ";";
			mysql.query(queryString, function(err, rows) {
				if (err) {
					console.log("Err ID: 121");
					throw err;
				}
			});
			//mysql.end();
			return;
		});
	}
}

function processStep(step) {
	if (step.info != "") {
		var alertString = step.info;
	}
	if (step.step != "") {
		alertString = step.step;
	}
	globalSocket.emit("newBrewStep", alertString, step);
	if (resumeBrewing == true) {
		// console.log("activeBrewStateData.step.id: " + activeBrewStateData.step.id);
		// console.log("step.id: " + step.id);
		if (activeBrewStateData.step.id == step.id) {
			if (debugLevel > 0) {console.log('Finished Resuming');};
			resumeBrewing = false;
			return;
		} else {
			resumeStepNum++;
			getBrewStep();
			return;
		}
	}
	mysql.connect(function(err) {
		var queryString = "UPDATE `brew_schedule` SET `begin_time`=NOW() WHERE `id`=" + step.id + ";";
		// var queryString = "SELECT * FROM `brew_schedule` WHERE `end_time` IS NULL ORDER BY `id` DESC LIMIT 1;";
		mysql.query(queryString, function(err, rows) {
			if (err) {
				console.log("Err ID: 105");
				throw err;
			} else {

				if (step.ack == "TRUE" && resumeBrewing == true) {
					return;
				}
				try {
					if (parseInt(step.temp, 10) > 0) {
						var setTemperature = {
							equipid: step.equipid,
							temp: step.temp
						};
						setTemp(setTemperature);
					}
				} catch (err) {}
				if (step.wait == "") {
					countDownTime = 2000;
					timerEnd = Date.now()+2000;
				} else if (step.wait == "TIME") {
					if (step.id != lastStep && parseInt(step.time, 10) > 0) {
						countDownTime = parseInt(step.time, 10) * 60 * 1000;
						timerEnd = Date.now()+countDownTime;
						activeBrewState("countDownTime", countDownTime);
						lastStep = step.id;
					}
				} else if (step.wait == "TEMP") {
					//console.log("Waiting for Temp to reach " + step.temp + " on equipment ID: " + step.equipid);
					targetEquip = step.equipid;
					activeBrewState("targetEquip", targetEquip);
					return;
				}
			}
		});
	});
}

function endStep() {
	// console.log("endStep");
	if (activeBrewStateData.brewingActive == false) {
		return;
	} else {
		if (step.wait == "TEMP" && targetTempReached == false) {
			return;
		} else {
			// console.log("line 1493 > step.id: " + step.id);
			if (step.id != undefined) {
				mysql.connect(function(err) {
					var queryString = "UPDATE `brew_schedule` SET `end_time`=NOW() WHERE `id`=" + parseInt(step.id, 10) + ";";
					mysql.query(queryString, function(err, rows) {
						if (err) {
							console.log("Err ID: 106");
							return;
						} else {
							globalSocket.emit("countDownTimer", "00:00:00");
							countDownTime = 0;
							previousTime = 0;
							activeBrewState(["previousTime","countDownTime"],[previousTime,countDownTime]);
							getBrewStep();
						}
						return;
					});
				});
			}
		}
	}
}

function countDownTimer() {
	
	countDownRemaining = timerEnd - Date.now();

	activeBrewState(["previousTime","countDownTime"],[previousTime,countDownTime]);	
	days = Math.floor(countDownRemaining / (1000 * 60 * 60 * 24));
	hours = Math.floor((countDownRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
	minutes = Math.floor((countDownRemaining % (1000 * 60 * 60)) / (1000 * 60));
	seconds = Math.floor((countDownRemaining % (1000 * 60)) / 1000);
	if (step.wait == "TIME") {
		globalSocket.emit("countDownTimer", ("0" + hours).slice(-2) + ":" + ("0" + minutes).slice(-2) + ":" + ("0" + seconds).slice(-2));
	}
	countDownRemaining = countDownRemaining - 1000;
	activeBrewState("countDownRemaining", countDownRemaining);

	if (countDownRemaining <= 0) {
		countDownTime = 0;
		previousTime = 0;
		activeBrewState(["previousTime","countDownTime"],[previousTime,countDownTime]);
		if (activeBrewStateData.brewingActive == true) {
			endStep();
		}
	}
}
