var mysql = require("mysql");

	// First you need to create a connection to the db
var mysqlCon = mysql.createConnection({
  database: "brewcontroller",
  host: "brewcontroller",
  user: "root",
  password: "brewcontroller"
});

exports.mysqlCon = mysqlCon;
