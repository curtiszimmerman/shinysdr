(function () {
  "use strict";
  
  function mod(value, modulus) {
    return (value % modulus + modulus) % modulus;
  }

  function sending(name) {
    return function (obj) { obj[name](); };
  }
  
  var freqDB = [
    {freq: 1e6, label: "Station 1"},
    {freq: 1.5e6, label: "Station 2"},
    {freq: 2e6, label: "Station 3"},
  ];
  
  // Prepare to load real data using JSONP callback
  window.sdr_data = function (json) {
    json.forEach(function (table) {
      var columns = table[0];
      table.slice(1).forEach(function (row) {
        var record = Object.create(null);
        columns.forEach(function (name, index) {
          record[name] = row[index];
        });
        var freqMHz = parseFloat(record.Frequency);
        if (isNaN(freqMHz)) {
          console.log('Bad freq!', record);
        }
        freqDB.push({
          freq: freqMHz * 1e6,
          label: record.Name
        })
      })
    });
  }
  
  var view = {
    fullScale: 10,
    // width of spectrum display from center frequency in Hz
    halfBandwidth: 1.5e6
  };
  
  function SpectrumPlot(buffer, canvas, view) {
    var ctx = canvas.getContext("2d");
    ctx.canvas.width = parseInt(getComputedStyle(canvas).width);
    //ctx.strokeStyle = "currentColor";
    ctx.strokeStyle = getComputedStyle(canvas).color;
    this.draw = function () {
      var w = ctx.canvas.width;
      var h = ctx.canvas.height;
      var len = buffer.length;
      var scale = ctx.canvas.width / len;
      var yScale = -h / view.fullScale;
      var yZero = h;
      
      ctx.clearRect(0, 0, w, h);
      
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, yZero + buffer[0] * yScale);
      for (var i = 1; i < len; i++) {
        ctx.lineTo(i * scale, yZero + buffer[i] * yScale);
      }
      ctx.stroke();
    };
  }
  
  function WaterfallPlot(buffer, canvas, view) {
    canvas.width = buffer.length;
    var ctx = canvas.getContext("2d");
    var ibuf = ctx.createImageData(ctx.canvas.width, 1);
    this.draw = function () {
      var w = ctx.canvas.width;
      var h = ctx.canvas.height;
      var len = buffer.length;
      var scale = len / ctx.canvas.width;
      var colorScale = 255 / view.fullScale;
      
      // scroll
      ctx.drawImage(ctx.canvas, 0, 0, w, h-1, 0, 1, w, h-1);
      
      // new data
      var data = ibuf.data;
      for (var x = 0; x < w; x++) {
        var base = x * 4;
        var intensity = buffer[Math.round(x * scale)] * colorScale;
        var redBound = 255 - intensity / 4;
        data[base] = intensity;
        data[base + 1] = Math.min(intensity * 2, redBound);
        data[base + 2] = Math.min(intensity * 4, redBound);
        data[base + 3] = 255;
      }
      ctx.putImageData(ibuf, 0, 0);
    };
  }
  
  function Knob(target) {
    var container = this.element = document.createElement("span");
    container.className = "knob";
    var places = [];
    var marks = [];
    for (var i = 8; i >= 0; i--) (function(i) {
      if (i % 3 == 2) {
        var mark = container.appendChild(document.createElement("span"));
        mark.className = "knob-mark";
        mark.textContent = ",";
        mark.style.visibility = "hidden";
        marks.unshift(mark);
        // TODO: make marks responsive to scroll events (doesn't matter which neighbor, or split in the middle, as long as they do something).
      }
      var digit = container.appendChild(document.createElement("span"));
      digit.className = "knob-digit";
      digit.tabIndex = -1;
      var digitText = digit.appendChild(document.createTextNode("\u00A0"));
      places[i] = {element: digit, text: digitText};
      var scale = Math.pow(10, i);
      digit.addEventListener("mousewheel", function(event) { // Not in FF
        // TODO: deal with high-res/accelerated scrolling
        var adjust = event.wheelDelta > 0 ? 1 : -1;
        target.set(adjust * scale + target.get());
        event.preventDefault();
        event.stopPropagation();
      }, true);
      digit.addEventListener("keypress", function(event) {
        // TODO: arrow keys/backspace
        var input = parseInt(String.fromCharCode(event.charCode), 10);
        if (isNaN(input)) return;
        
        var value = target.get();
        var negative = value < 0;
        if (negative) { value = -value; }
        var currentDigitValue = Math.floor(value / scale) % 10;
        value += (input - currentDigitValue) * scale;
        if (negative) { value = -value; }
        target.set(value);
        
        if (i > 0) {
          places[i - 1].element.focus();
        } else {
          digit.blur();
        }
        
        event.preventDefault();
        event.stopPropagation();
      }, true);
    }(i));
    var lastShownValue = -1;
    
    this.draw = function () {
      var value = target.get();
      if (value === lastShownValue) return;
      lastShownValue = value;
      var valueStr = "" + value;
      var last = valueStr.length - 1;
      for (var i = 0; i < places.length; i++) {
        places[i].text.data = valueStr[last - i] || '\u00A0';
      }
      var numMarks = Math.floor((valueStr.replace("-", "").length - 1) / 3);
      for (var i = 0; i < marks.length; i++) {
        marks[i].style.visibility = i < numMarks ? "visible" : "hidden";
      }
    };
  }
  
  function FreqScale(tunerSource) {
    var outer = this.element = document.createElement("div");
    outer.className = "freqscale";
    var numbers = outer.appendChild(document.createElement("div"));
    numbers.className = "freqscale-numbers";
    var stations = outer.appendChild(document.createElement("div"));
    stations.className = "freqscale-stations";
    var lastShownValue = NaN;
    // TODO: reuse label nodes instead of reallocating...if that's cheaper
    this.draw = function() {
      var centerFreq = tunerSource.get();
      if (centerFreq === lastShownValue) return;
      lastShownValue = centerFreq;
      
      var scale = 100 / (view.halfBandwidth * 2);
      var step = 0.5e6;
      var lower = centerFreq - view.halfBandwidth;
      var upper = centerFreq + view.halfBandwidth;
      
      function position(freq) {
        return ((freq - centerFreq) * scale + 50) + "%";
      }
      
      numbers.textContent = "";
      for (var i = lower - mod(lower, step); i <= upper; i += step) {
        var label = numbers.appendChild(document.createElement("span"));
        label.className = "freqscale-number";
        label.textContent = (i / 1e6) + "MHz";
        label.style.left = position(i);
      }
      
      stations.textContent = "";
      freqDB.forEach(function (record) {
        var freq = record.freq;
        if (freq >= lower && freq <= upper) {
          var el = stations.appendChild(document.createElement("span"));
          el.className = "freqscale-station";
          el.textContent = record.label;
          el.style.left = position(freq);
        }
      });
    };
  }
  
  var state = {
    tuner: 1e6,
    demod: 0
  };
  
  var fft = new Float32Array(2048);
  
  var widgets = [];
  widgets.push(new SpectrumPlot(fft, document.getElementById("spectrum"), view));
  widgets.push(new WaterfallPlot(fft, document.getElementById("waterfall"), view));

  var widgetTypes = Object.create(null);
  widgetTypes.Knob = Knob;
  widgetTypes.FreqScale = FreqScale;
  function makeBinding(name) {
    return {
      get: function() { return state[name]; },
      set: function(v) { state[name] = v; }
    };
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-widget]"), function (el) {
    var T = widgetTypes[el.getAttribute("data-widget")];
    if (!T) {
      console.error('Bad widget type:', el);
      return;
    }
    var widget = new T(makeBinding(el.getAttribute("data-target")));
    widgets.push(widget);
    el.parentNode.replaceChild(widget.element, el);
  })
  
  // Mock Fourier-transformed-signal source
  setInterval(function() {
    var tuner = state.tuner;
    var step = view.halfBandwidth * 2 / fft.length;
    var zeroPos = tuner - view.halfBandwidth;
    for (var i = fft.length - 1; i >= 0; i--) {
      var first = (zeroPos + i * step);
      var v = 2 + Math.random() * 1;
      v += 3 * Math.exp(-Math.pow(first - 1e6, 2) / 100e6);
      v += 1.5 * Math.exp(-Math.pow(first - 1.5e6, 2) / 100e6);
      v += 6 * Math.exp(-Math.pow(first - 2e6, 2) / 100e6);
      fft[i] = v;
    }
    doDisplay();
  }, 1000/20);
  
  var displayQueued = false;
  function doDisplay() {
    if (displayQueued) { return; }
    displayQueued = true;
    window.webkitRequestAnimationFrame(function() {
      displayQueued = false;
      widgets.forEach(sending("draw"));
    });
  }
}());