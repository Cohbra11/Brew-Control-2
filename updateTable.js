var updateTable = function() {
	var fs = require('fs');
	var self = this;

	var tableName;
	var temp;
	var timespan;
	var numRows = 0;
	var tempArray = [];
	var setpointArray = [];
	var timeArray = [];
	var timeSpan = [];
	var obj = {};
	var new_json;
	var setpoint = 0;
	var queryString;
	var mysql = require('./connect-mysql.js').mysqlCon;
	var tabelNameBuffer;
	var setPointBuffer;
	var timeSpanBuffer;

	self.getResults = function(updateControlId, tempUnits, tempReading, setpoint) {
		tableName = 'control' + updateControlId + '_temp';
		mysql.connect(function(err) {
			queryString = "SELECT * FROM " + tableName + " ORDER BY id DESC LIMIT 1;";
			mysql.query(queryString, function(err, rows) {
				if (err) {
					console.log("error 126");
					return;
				} else {
					timespan = rows[0].timespan;
					temp = rows[0].temp;
					if ((tempReading >= 0) && (tempReading <= 300)) {
						temp = tempReading;
					}
					queryString = "REPLACE INTO " + tableName + " (timestamp, temp, setpoint, timespan) VALUES (NOW()," + temp + "," + setpoint + "," + timespan + ")";
					mysql.query(queryString, function(err, rows) {
						if (err) {
							console.log("queryString: " + queryString);
							console.log("error 123");
							return;
						} else {
							queryString = "SELECT id FROM " + tableName + " ORDER BY id DESC LIMIT 1;";
							mysql.query(queryString, function(err, rows) {
								if (err) {
									console.log("error 122");
									return;
								} else {
									//rowsToDelete = +(rows[0].id) - timespan;
									var minRowId = +(rows[0].id) - timespan;
									exports.temp = temp;
									// queryString = "SELECT id FROM " + tableName + " ORDER BY id DESC LIMIT 1 OFFSET "+timespan+";";
									// mysql.query(queryString, function(err, rows) {
										// if (err) {
											// console.log("error 124");
											// return;
										// } else {
											// console.log(rows[0].id);
											queryString = "SELECT * FROM " + tableName + " WHERE id > "+minRowId+" ORDER BY id ASC;";
											mysql.query(queryString, function(err, rows) {
												if (err) {
													console.log("error 125");
													return;
												} else {
													var i;
													for (i in rows) {
														tempArray[i] = rows[i].temp;
														setpointArray[i] = rows[i].setpoint;
														timeArray[i] = rows[i].timestamp;
													}

													obj = {
														"temp": tempArray,
														"setpoint": setpointArray,
														"time": timeArray,
														"count": rows.length,
														"timespan": rows[rows.length - 1].timespan,
														"tempUnits": tempUnits
													};
													new_json = JSON.stringify(obj, null, 2);
												}
												fs.writeFileSync('client/jsonFiles/' + tableName + '.json', new_json, 'utf8', function() {});
											});

										// }
									// });
								}
							});

						}
					});
				}
			});
		});
	};
};
module.exports = updateTable;