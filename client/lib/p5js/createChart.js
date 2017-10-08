
var MYLIBRARY = MYLIBRARY || (function(){
    var _args = {}; // private

    return {
        init : function(Args) {
            _args = Args;
            // some other initialising
        },
        createChart : function() {
            var chartID = _args[0];
			var chartSize = _args[1];//Use auto chart size scaling
			//var chartSize = 100;//Use fixed chart size scaling
			var chartName = _args[2];

			var Chart = function(chart) {
				var numDataPoints;
				var datapointY = [];
				var setpoint = [];
				var dataPointTime = [];
				var timespan;
				var chartHeight;
				var chartWidth;
				var chartMax;
				var chartMin;
				var chartRange;
				var padTop;
				var padBottom;
				var padLeft;
				var padRight;
				var pxPerDegree;
				var pxPerTime;
				var windowWidth;
				var windowHeight;
				var horizGrids;
				var vertGrids;
				var minorHorizGrid;
				var minorVertGrid;
				var url;
				var setX;
				var setY;
				var hoverTemp = false;
				var lastChartSize;
				var tempUnits;
	
		  	chart.setup = function() {
		  	  	var canvas = chart.createCanvas(chartSize, chartSize*.66);
				url = 'jsonFiles/control'+chartID+'_temp.json';
		  	  	canvas.parent('chart'+chartID);
		  	  	chart.frameRate(1);
		  	    chart.ellipseMode(chart.CENTER);
				padTop = .025*chart.width;
				padBottom = .1*chart.width;
				padLeft = .15*chart.width;
				padRight = .1*chart.width;
			};
				
		  	chart.draw = function() {
		  		chartSize = document.getElementById(chartName).offsetWidth;
		  		if(chartSize != lastChartSize){
		  			lastChartSize = chartSize;
		  			chart.resizeCanvas(chartSize, chartSize*.66);
					padTop = .025*chart.width;
					padBottom = .1*chart.width;
					padLeft = .15*chart.width;
					padRight = .1*chart.width;
				}
			    chart.loadJSON(url, parseData);
			    chart.calculate();
			  	chart.background(0);
		  		chart.horizontalGrid();
		  		chart.verticalGrid();
		  		chart.renderGraph();
		  	};
		  	
		  	function parseData(data){
		  		chartMax = 0;
		  		chartMin = 1000;
		  		var x;
		  		tempUnits = data.tempUnits;
			  	for (x = 0; x < data.count; x++){
					datapointY[x] = data.temp[x];
					setpoint[x] = data.setpoint[x];
				  	dataPointTime[x] = data.time[x];
			  	    
			  	    if (datapointY[x]>chartMax){
			  	    	chartMax = datapointY[x];
			  	    }
			  	    if (datapointY[x]<chartMin){
			  	    	chartMin = datapointY[x];
			  	    }
			  	    if (setpoint[x] <0 || setpoint[x]==null){
			  	    	setpoint[x] = 0;
			  	    }
		  		}
				// timespan = data.count-1;
				timespan = data.count;
				document.getElementById(chartName+"timeSpan").value = data.count;
		  		numDataPoints = data.count;
				if(chartMin < 0){
		  			chartMin = 0;
		  		}
		  	}
		  	
		  	chart.calculate = function(){
		  		chartMax = Math.ceil(((chartMax+5))/5)*5;
		  		chartMin = Math.floor(((chartMin-5))/5)*5;
		  		if (chartMin < 0){
		  			chartMin = 0;
		  		}
			  	chartRange = chartMax - chartMin;
		  		windowWidth = chart.width;
		  		windowHeight = chart.height;
		  		chartWidth = windowWidth-padLeft-padRight;
		  		chartHeight = windowHeight-padTop-padBottom;
			  	pxPerDegree = chartHeight/chartRange;
			  	pxPerTime = chartWidth/(numDataPoints-1);
		  	};
			  		  	
		  	chart.renderGraph = function() {
			  	chart.stroke(100);
			  	chart.fill(255,50);
		  		chart.textSize(chart.height/10);
			  	for (var k = 0; k < numDataPoints-1; k++) {
		  			var setpointToUse = setpoint[k];
		  			var setpointToUse2 = setpoint[k+1];
					if (setpointToUse<chartMin){
						setpointToUse = chartMin;
					}  
					if (setpointToUse>chartMax){
						setpointToUse = chartMax;
					}  
					if (setpointToUse2<chartMin){
						setpointToUse2 = chartMin;
					}  
					if (setpointToUse2>chartMax){
						setpointToUse2 = chartMax;
					}  
			  		var x1 = (k*pxPerTime)+padLeft;
			  		var x2 = ((k+1)*pxPerTime)+padLeft;
			  		var y1 = windowHeight-padBottom-(datapointY[k]*pxPerDegree)+(chartMin*pxPerDegree);
			  		var y2 = windowHeight-padBottom-(datapointY[k+1]*pxPerDegree)+(chartMin*pxPerDegree);
			  		var setPointy1 = windowHeight-padBottom-(setpointToUse*pxPerDegree)+(chartMin*pxPerDegree);
			  		var setPointy2 = windowHeight-padBottom-(setpointToUse2*pxPerDegree)+(chartMin*pxPerDegree);
			    	chart.line(x1, y1, x2, y2);//draw the temperature line
			    	chart.ellipse(x2, y2, 2, 2);
				    if (hoverTemp == true){
			    		chart.stroke(255,216,0);
			    		chart.strokeWeight(4);
				    }else{
			    		chart.stroke(255,61,163);
			    		chart.strokeWeight(1);
				    }
				    chart.line(x1, setPointy1, x2, setPointy2);//draw the setpoint line
			    	chart.stroke(100);
			    	chart.strokeWeight(1);
			  	}
			    chart.fill(255,0,0);
				chart.ellipse(x2, y2, 10, 10);
				chart.textAlign(chart.RIGHT, chart.CENTER);
				chart.text((Math.round(datapointY[k]*100)/100)+"°", x2-5, y2);
				//draw temp setpoint triangle
			    var tX1 = windowWidth-padRight ;
			    var tY1 = windowHeight-padBottom-(setpointToUse*pxPerDegree)+(chartMin*pxPerDegree);
			    setX = tX1+15;
			    setY = tY1;
			    var tX2 = windowWidth-padRight+10;
			    var tY2 = tY1-5;
			    var tX3 = windowWidth-padRight+10;
			    var tY3 = tY1+5;
			    if (hoverTemp == true){
		    		chart.fill(255,216,0);
			    	chart.textSize(chart.height/15);
			    }else{
		    		chart.fill(255,61,163);
			    	chart.textSize(chart.height/25);
			    }
			    chart.textAlign(chart.LEFT, chart.CENTER);
			    chart.text(setpoint[k]+"°", setX, setY);
			    chart.triangle(tX1, tY1, tX2, tY2, tX3, tY3);	  	    	
		  	};
			  	
		  	chart.horizontalGrid = function() {
		  		horizGrids = 10;
		  		minorHorizGrid = 1;
		  		var majorGridSpacing = chartHeight/horizGrids;
		  		var tempVal;
		  		for(var g = 0; g <= horizGrids; g++) {
		  			chart.stroke(30);
		  			chart.line(padLeft-3, (majorGridSpacing*g)+padTop, chartWidth+padLeft, (majorGridSpacing*g)+padTop);
		  	    chart.fill(255,0,0);
			  		chart.textSize(chart.height/25);
			  		chart.textAlign(chart.RIGHT, chart.CENTER);
			  		tempVal = (chartMax-(g*(chartRange/horizGrids)));
		 				chart.text((tempVal+"°"), padLeft - 2, ((chartHeight/horizGrids)*g)+padTop);
						chart.textSize(chart.height/15);
						chart.textAlign(chart.LEFT, chart.CENTER);
						chart.text("°"+tempUnits, 3, windowHeight/2);
		 				if (minorHorizGrid == 1 && g < horizGrids){
		 					chart.stroke(15);
							chart.line(padLeft-1, (majorGridSpacing*g)+padTop+(majorGridSpacing/2), chartWidth+padLeft, (majorGridSpacing*g)+padTop+(majorGridSpacing/2));
		 				}
		  		}
		  	};
			  	
		  	chart.verticalGrid = function() {
		  		vertGrids = 10;
		  		minorVertGrid = 1;
		  		var majorGridSpacing = chartWidth/vertGrids;
		  		for(var t = 0; t <= vertGrids; t++){
		  			var timeVal = ((timespan/vertGrids)*t);
		  			timeVal = Math.round(timeVal);
		  			chart.stroke(30);
		  			chart.line(windowWidth-padRight-(majorGridSpacing*t), padTop+chartHeight+3 , windowWidth-padRight-(majorGridSpacing*t), padTop);
			    	chart.fill(255,216,0);
		  			chart.stroke(30);
		   			chart.textSize(chart.height/25);
		   			chart.textAlign(chart.CENTER, chart.TOP);
		   			chart.text(timeVal, windowWidth-padRight-(majorGridSpacing*t), padTop+chartHeight+3);
		  			chart.textSize(chart.height/15);
		  			chart.textAlign(chart.CENTER, chart.BOTTOM);
		  			chart.text("Seconds", windowWidth/2, windowHeight-2);
		   			if (minorVertGrid == 1 && t < vertGrids){
		   				chart.stroke(15);
		  				chart.line(windowWidth-padRight-(majorGridSpacing*t)-(majorGridSpacing/2), padTop+chartHeight+3, windowWidth-padRight-(majorGridSpacing*t)-(majorGridSpacing/2), padTop);
		   			}
		  		}
		  	};
			};
			new p5(Chart, document.getElementById(chartName));
		}
    };
}());