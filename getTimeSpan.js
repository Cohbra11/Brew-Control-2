var updateTable = function(){
var self = this;
	
	var timeSpan;
	var queryString;
	var mysql = require('./connect-mysql.js').mysqlCon;
	
	self.getResults = function(socket, chartID){
// If the timespan for the chart has changed...
		mysql.connect(function(err){
	    	queryString = "SELECT timespan FROM control"+chartID+"_temp ORDER BY id DESC LIMIT 1;";
			mysql.query(queryString,  function(err, rows){
	  			if(err)	{
	  				throw err;
		    	}else{
	        		timeSpan = rows[0].timespan;
					socket.emit("timespan", timeSpan);
		    	}
			});
		    chartID = null;
		    //mysql.end();
		});
	};
};
module.exports = updateTable;