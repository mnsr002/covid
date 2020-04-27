/*
/*
 * DEPENDENCIES
*/

const {
  DeckGL,
  GeoJsonLayer,
  TextLayer,
  ScatterplotLayer
} = deck;


/*
 * CONFIG
*/

const COLOR_SCALE = [
  [240, 240, 240],
  // positive
  [255, 255, 204],
  [255, 237, 160],
  [254, 217, 118],
  [254, 178, 76],
  [253, 141, 60],
  [252, 78, 42],
  [227, 26, 28],
  [189, 0, 38],
  [128, 0, 38]
];

var lisa_labels = ["Not significant", "High-High", "Low-Low", "High-Low", "Low-High", "Undefined", "Isolated"];
var lisa_colors = ["#ffffff", "#FF0000", "#0000FF", "#a7adf9", "#f4ada8", "#464646", "#999999"];


/*
 * UTILITIES
*/

function isInt(n) {
  return Number(n) === n && n % 1 === 0;
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
}

function getDatesFromGeojson(data) {
  var xLabels = [];
  for (var col in data["features"][0]["properties"]) {
    if (col.startsWith("2020")) {
      xLabels.push(col);
    }
  }
  return xLabels;
}

function saveText(text, filename) {
  var a = document.createElement('a');
  a.setAttribute("id", filename);
  a.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  a.setAttribute('download', filename);
  a.click()
}


/*
 * GLOBALS
*/

// data
var usafactsCases;
var usafactsDeaths;
var usafactsData;
var onep3aData;
var populationData = {};
var bedsData = {};
var cartogramData;
var dates = {};
var caseData = {};
var deathsData = {};
var fatalityData = {};
var lisaData = {};
// socioeconomic indicators from the county health rankings group (aka chr).
// this is an object indexed by county fips.
var chrData = {};

// ui elements
var choropleth_btn = document.getElementById("btn-nb");
var lisa_btn = document.getElementById("btn-lisa");
var data_btn = document.getElementById("select-data");
var source_btn = document.getElementById("select-source");

// geoda
var gda_proxy;
var gda_weights = {};
// TODO what is this?
var jsondata = {};
var centroids = {};

// misc
var current_view = null;
var colorScale;

var getFillColor = function() {
  return [255, 255, 255, 200];
};
var getLineColor = function() {
  return [220, 220, 220];
};


/*
 * STATE
*/

// the selected data source (e.g. county_usfacts.geojson)
var selectedDataset = null;
var selectedId = null;
var selectedDate = null;
var selectedVariable = null;
var selectedMethod = null;
var shouldShowLabels = false;

// these look like dataset file name constants, but they are actually default
// values for state variables. for example, countyMap can change when switching
// between 1p3a counties and usafacts counties.
var stateMap = 'states_update.geojson';
var countyMap = 'county_usfacts.geojson';

function isState() {
  return source_btn.innerText.indexOf('State') >= 0;
}

function isLisa() {
  return document.getElementById("btn-lisa").classList.contains("checked");
}

function isCartogram() {
  return document.getElementById('cartogram-ckb').checked;
}

function getCurrentWuuid() {
  if (!(selectedDataset in gda_weights)) {
    var w = gda_proxy.CreateQueenWeights(selectedDataset, 1, 0, 0);
    gda_weights[selectedDataset] = w;
  }
  return {
    'map_uuid': selectedDataset,
    'w_uuid': gda_weights[selectedDataset].get_uid()
  };
}

function updateSelectedDataset(url, callback = () => {}) {
  // update selected dataset
  if (url.endsWith('county_usfacts.geojson')) {
    selectedDataset = 'county_usfacts.geojson';
  } else {
    if (url.endsWith('counties_update.geojson')) {
      selectedDataset = 'counties_update.geojson';
    } else {
      selectedDataset = 'states_update.geojson';
    }
  }
  updateDates();
  callback();
}


/*
 * DATA LOADING
*/

// fetch county health rankings social indicators (aka chr)
async function fetchChrData() {
  const rows = await d3.csv('chr_social_indicators.csv');

  // index rows by "fips" (unique id)
  const rowsIndexed = rows.reduce((acc, row) => {
    acc[row.FIPS] = row;
    return acc;
  }, {});

  return rowsIndexed;
}

// this is effectively the entry point for data loading, since usafacts is the
// dataset selected by default. note that it has side effects unrelated to data
// fetching, namely updating selectedDataset.
async function loadUsafactsData(url, callback) {
  // load usfacts geojson data
  const responseForJson = await fetch(url);
  const responseForArrayBuffer = responseForJson.clone();
  
  // read as geojson for map
  const json = await responseForJson.json();
  const featuresWithIds = assignIdsToFeatures(json);
  usafactsData = featuresWithIds;

  // load cases and deaths in parallel. also load "supplemental" data (e.g. chr)
  // note that because these are being destructured to pre-defined globals,
  // this has the side effect of loading data into state.
  [
    usafactsCases,
    usafactsDeaths,
    chrData,
  ] = await Promise.all([
    d3.csv('covid_confirmed_usafacts.csv'),
    d3.csv('covid_deaths_usafacts.csv'),
    fetchChrData(),
  ]);

  // update state
  // TODO isn't there a function that does this?
  updateSelectedDataset(countyMap);

  // merge usfacts csv data
  parseUsaFactsData(featuresWithIds, usafactsCases, usafactsDeaths);
  jsondata[selectedDataset] = featuresWithIds;

  // read as bytearray for GeoDaWASM
  const arrayBuffer = await responseForArrayBuffer.arrayBuffer();

  gda_proxy.ReadGeojsonMap(url, {
    result: arrayBuffer,
  });

  // get centroids for cartogram
  centroids[selectedDataset] = gda_proxy.GetCentroids(url);

  callback();
}

function load1p3aData(url, callback) {
  // load 1P3A data 
  zip.workerScripts = {
    deflater: ['./js/z-worker.js', './js/pako/pako_deflate.min.js', './js/pako/codecs.js'],
    inflater: ['./js/z-worker.js', './js/pako/pako_inflate.min.js', './js/pako/codecs.js']
  };
  fetch(url + ".zip")
    .then((response) => {
      return response.blob();
    })
    .then((blob) => {
      // use a BlobReader to read the zip from a Blob object
      zip.createReader(new zip.BlobReader(blob), function (reader) {
        // get all entries from the zip
        reader.getEntries(function (entries) {
          if (entries.length) {
            // uncompress first entry content as blob
            entries[0].getData(new zip.BlobWriter(), function (bb) {
              // read as bytearray for GeoDaWASM
              var fileReader = new FileReader();
              fileReader.onload = function (event) {
                var ab = event.target.result;
                gda_proxy.ReadGeojsonMap(url, {
                  result: ab
                });

                let sel_map = url.startsWith('state') ? 'state' : 'county';
                selectedDataset = sel_map == 'state' ? 'states_update.geojson' : 'counties_update.geojson';
                // read as json
                var jsonReader = new FileReader();
                jsonReader.onload = function (event) {
                  let data = JSON.parse(event.target.result);
                  data = assignIdsToFeatures(data);
                  onep3aData = data;
                  parse1P3AData(data);
                  jsondata[selectedDataset] = data;
                  callback();
                };
                jsonReader.readAsText(bb);
                centroids[selectedDataset] = gda_proxy.GetCentroids(url);
              };
              fileReader.readAsArrayBuffer(bb);
              // close the zip reader
              reader.close(function () { // onclose callback
              });
            }, function (current, total) { // onprogress callback
            });
          }
        });
      }, function (error) { // onerror callback
        console.log("zip wrong");
      });
    });
}

// this takes a url and loads the data source (if it hasn't been already)
// note: the url is generally just the file name, since these are local to the
// project
function loadData(url, callback) {
  // check if the data has already been loaded (it goes into the geoda proxy)
  if (gda_proxy.Has(url)) {
    updateSelectedDataset(url, callback);
  // otherwise, we need to fetch the data  
  } else if (url.endsWith('county_usfacts.geojson')) {
    loadUsafactsData(url, callback);
  } else {
    load1p3aData(url, callback);
  }
}

function getDatesFromUsafacts(cases) {
  var xLabels = [];
  let n = cases.length;
  for (let col in cases[0]) {
    if (col.endsWith('20')) {
      xLabels.push(col);
    }
  }
  return xLabels;
}

function parseUsaFactsData(data, confirm_data, death_data) {
  let json = selectedDataset;
  if (!(json in caseData)) caseData[json] = {};
  if (!(json in deathsData)) deathsData[json] = {};
  if (!(json in fatalityData)) fatalityData[json] = {};
  if (!(json in populationData)) populationData[json] = {};
  if (!(json in bedsData)) bedsData[json] = {};

  dates[selectedDataset] = getDatesFromUsafacts(confirm_data);
  if (selectedDate == null || selectedDate.indexOf('-') >= 0)
    selectedDate = dates[selectedDataset][dates[selectedDataset].length - 1];

  let conf_dict = {};
  let death_dict = {};
  for (let i = 0; i < confirm_data.length; ++i) {
    conf_dict[confirm_data[i].countyFIPS] = confirm_data[i];
    death_dict[death_data[i].countyFIPS] = death_data[i];
  }
  for (let i = 0; i < data.features.length; i++) {
    let pop = data.features[i].properties.population;
    let geoid = parseInt(data.features[i].properties.GEOID);
    let beds = data.features[i].properties.beds;
    if (!(geoid in conf_dict)) {
      console.log("UsaFacts does not have:", data.features[i].properties);
      for (let j = 0; j < dates[selectedDataset].length; ++j) {
        let d = dates[selectedDataset][j];
        caseData[json][d][i] = 0;
        deathsData[json][d][i] = 0;
        fatalityData[json][d][i] = 0;
      }
      continue;
    }
    populationData[json][i] = pop;
    bedsData[json][i] = beds;

    // confirmed count
    for (let j = 0; j < dates[selectedDataset].length; ++j) {
      let d = dates[selectedDataset][j];
      if (!(d in caseData[json])) {
        caseData[json][d] = {};
      }
      caseData[json][d][i] = conf_dict[geoid][d] == '' ? 0 : parseInt(conf_dict[geoid][d]);
    }
    // death count
    for (var j = 0; j < dates[selectedDataset].length; ++j) {
      var d = dates[selectedDataset][j];
      if (!(d in deathsData[json])) {
        deathsData[json][d] = {};
      }
      deathsData[json][d][i] = death_dict[geoid][d] == '' ? 0 : parseInt(death_dict[geoid][d]);
    }
    // fatality
    for (var j = 0; j < dates[selectedDataset].length; ++j) {
      var d = dates[selectedDataset][j];
      if (!(d in fatalityData[json])) {
        fatalityData[json][d] = {};
      }
      fatalityData[json][d][i] = 0;
      if (caseData[json][d][i] > 0) {
        fatalityData[json][d][i] = deathsData[json][d][i] / caseData[json][d][i];
      }
    }
  }
}

function parse1P3AData(data) {
  let json = selectedDataset;
  if (!(json in caseData)) caseData[json] = {};
  if (!(json in deathsData)) deathsData[json] = {};
  if (!(json in fatalityData)) fatalityData[json] = {};
  if (!(json in populationData)) populationData[json] = {};
  if (!(json in bedsData)) bedsData[json] = {};

  dates[selectedDataset] = getDatesFromGeojson(data);
  if (selectedDate == null || selectedDate.indexOf('/'))
    selectedDate = dates[selectedDataset][dates[selectedDataset].length - 1];

  for (let i = 0; i < data.features.length; i++) {
    let conf = data.features[i].properties.confirmed_count;
    let death = data.features[i].properties.death_count;
    let pop = data.features[i].properties.population;
    let id = data.features[i].properties.id;
    let beds = data.features[i].properties.beds;

    populationData[json][id] = pop;
    bedsData[json][id] = beds;

    // confirmed count
    for (var j = 0; j < dates[selectedDataset].length; ++j) {
      var d = dates[selectedDataset][j];
      if (!(d in caseData[json])) {
        caseData[json][d] = {};
      }
      caseData[json][d][id] = data.features[i]["properties"][d];
    }
    // death count
    for (var j = 0; j < dates[selectedDataset].length; ++j) {
      var d = dates[selectedDataset][j];
      if (!(d in deathsData[json])) {
        deathsData[json][d] = {};
      }
      deathsData[json][d][id] = data.features[i]["properties"]['d' + d];
    }
    // accum
    for (var j = 1; j < dates[selectedDataset].length; ++j) {
      var d1 = dates[selectedDataset][j - 1];
      var d2 = dates[selectedDataset][j];
      caseData[json][d2][id] += caseData[json][d1][id];
      deathsData[json][d2][id] += deathsData[json][d1][id];
    }
    // fatality
    for (var j = 0; j < dates[selectedDataset].length; ++j) {
      var d = dates[selectedDataset][j];
      if (!(d in fatalityData[json])) {
        fatalityData[json][d] = {};
      }
      fatalityData[json][d][id] = 0;
      if (caseData[json][d][id] > 0) {
        fatalityData[json][d][id] = deathsData[json][d][id] / caseData[json][d][id];
      }
    }
  }
}

function updateDates() {
  // since 1P3A has different date format than usafacts
  if (selectedDataset == 'county_usfacts.geojson') {
    // todo: the following line should be updated to current date
    dates[selectedDataset] = getDatesFromUsafacts(usafactsCases);
    if (selectedDate == null || selectedDate.indexOf('-') >= 0)
      selectedDate = dates[selectedDataset][dates[selectedDataset].length - 1];
  } else {
    dates[selectedDataset] = getDatesFromGeojson(onep3aData);
    // todo: the following line should be updated to current date
    if (selectedDate == null || selectedDate.indexOf('/') >= 0)
      selectedDate = dates[selectedDataset][dates[selectedDataset].length - 1];
  }
}


/*
 * UI / EVENT HANDLERS
*/

// this is the callback for when a county dataset is selected. it is also the
// rendering function that gets called on load.
function OnCountyClick(target) {
  if (target != undefined) {
    if (target.innerText.indexOf('UsaFacts') >= 0) {
      countyMap = "county_usfacts.geojson";
    } else {
      countyMap = "counties_update.geojson";
    }
  }
  loadData(countyMap, initCounty);
}

function initCounty() {
  var vals;
  var nb;
  selectedMethod = "choropleth";
  vals = GetDataValues();
  nb = gda_proxy.custom_breaks(countyMap, "natural_breaks", 8, null, vals);
  colorScale = function (x) {
    if (x == 0) return COLOR_SCALE[0];
    for (var i = 1; i < nb.breaks.length; ++i) {
      if (x < nb.breaks[i])
        return COLOR_SCALE[i];
    }
  };
  getFillColor = function (f) {
    let v = GetFeatureValue(f.properties.id);
    if (v == 0) return [255, 255, 255, 200];
    return colorScale(v);
  };
  getLineColor = function (f) {
    return f.properties.id == selectedId ? [255, 0, 0] : [200, 200, 200];
  };
  UpdateLegend();
  UpdateLegendLabels(nb.bins);
  choropleth_btn.classList.add("checked");
  lisa_btn.classList.remove("checked");

  if (isCartogram()) {
    cartogramData = gda_proxy.cartogram(countyMap, vals);
  }
  loadMap(countyMap);
}

function OnStateClick() {
  loadData(stateMap, init_state);
}

function init_state() {
  var vals;
  var nb;
  selectedMethod = "choropleth";
  vals = GetDataValues();
  nb = gda_proxy.custom_breaks(stateMap, "natural_breaks", 8, null, vals);
  colorScale = function (x) {
    if (x == 0) return COLOR_SCALE[0];
    for (var i = 1; i < nb.breaks.length; ++i) {
      if (x < nb.breaks[i])
        return COLOR_SCALE[i];
    }
  };
  getFillColor = function (f) {
    let v = GetFeatureValue(f.properties.id);
    if (v == 0) return [255, 255, 255];
    return colorScale(v);
  };
  getLineColor = function (f) {
    return f.properties.id == selectedId ? [255, 0, 0] : [255, 255, 255, 50];
  };
  UpdateLegend();
  UpdateLegendLabels(nb.bins);
  choropleth_btn.classList.add("checked");
  lisa_btn.classList.remove("checked");

  if (isCartogram()) {
    cartogramData = gda_proxy.cartogram(stateMap, vals);
  }

  loadMap(stateMap);
}

function OnSourceClick(evt) {
  source_btn.innerText = evt.innerText;
  if (evt.innerText.indexOf('UsaFacts') >= 0) {
    selectedDataset = 'county_usfacts.geojson';
  } else if (evt.innerText.indexOf('County (1Point3Arces.com)') >= 0) {
    selectedDataset = 'counties_update.geojson';
  } else {
    selectedDataset = 'states_update.geojson';
  }

  if (isState()) {
    OnStateClick();
  } else {
    OnCountyClick(evt);
  }

  // force back to choropleth
  selectedMethod = "choropleth";
  //updateDates();
  //if (isLisa()) {
  //    OnLISAClick(document.getElementById('btn-lisa'));
  //} else {
  // }
}

function OnDataClick(evt) {
  data_btn.innerText = evt.innerText;
  selectedVariable = evt.innerText;

  if (isLisa()) {
    OnLISAClick(document.getElementById('btn-lisa'));
  } else {
    selectedMethod = "choropleth";
    if (isState()) {
      OnStateClick();
    } else {
      OnCountyClick();
    }
  }
}

function OnCartogramClick() {
  selectedMethod = "choropleth";
  if (isState()) {
    OnStateClick();
  } else {
    OnCountyClick();
  }
}

function OnShowLabels(el) {
  shouldShowLabels = el.checked;
  if (isLisa()) {
    OnLISAClick(document.getElementById('btn-lisa'));
  } else {
    if (isState()) {
      OnStateClick();
    } else {
      OnCountyClick();
    }
  }
}

function collapse(el) {
  if (document.getElementById("toolbox").classList.contains("collapse")) {
    document.getElementById('toolbox').classList.remove("collapse");
    el.src = "img/collapse.png";
  } else {
    document.getElementById('toolbox').classList.add("collapse");
    el.src = "img/expand.png";
  }
}

function OnShowTime(el) {
  let disp = el.checked ? 'block' : 'none';
  document.getElementById('time-container').parentElement.style.display = disp;
}

function OnSave() {
  d3.json("lisa_dates.json", function (ds) {
    // only new lisa results will be saved
    let save_dates = [];
    let start_pos = dates[selectedDataset].indexOf(ds[ds.length - 1]) + 1;
    for (let i = start_pos; i < dates[selectedDataset].length; ++i) {
      let d = dates[selectedDataset][i];
      if (d in lisaData[selectedDataset]) {
        console.log('lisa' + d + '.json');
        save_dates.push(d);
        setTimeout(function () {
          saveText(JSON.stringify(lisaData[selectedDataset][d]), "lisa" + d + ".json");
        }, 100 * (i - ds.length));
      }
    }
    // update dates
    saveText(JSON.stringify(save_dates), "lisa_dates.json");
  });
}

function getTooltipHtml(values) {
  let text = '<div><h3>' + values.entityName + '</h3></div>';
  text += '<hr>';
  text += '<table>'
  text += '<tr><td><h5>Confirmed Count:</h5></td><td><h5>' + values.cases + '</h5></td>';
  text += '<tr><td><h5>Confirmed Count per 10K Population:</h5></td><td><h5>' + values.casesPer10k + '</h5></td>';
  text += '<tr><td><h5># Licensed Hospital Beds:</h5></td><td><h5>' + values.beds + '</h5></td>';
  text += '<tr><td><h5>Confirmed Count per Licensed Bed:</h5></td><td><h5>' + values.casesPerBed + '</h5></td>';
  text += '<tr><td><h5>Death Count:</h5></td><td><h5>' + values.deaths + '</h5></td>';
  text += '<tr><td><h5>Death Count per 10K Population:</h5></td><td><h5>' + values.deathsPer10k + '</h5></td>';
  text += '<tr><td><h5>Death Count/Confirmed Count:</h5></td><td><h5>' + values.fatalityRate + '</h5></td>';
  text += '<tr><td><h5>Daily New Confirmed Count:</h5></td><td><h5>' + values.newCases + '</h5></td>';
  text += '<tr><td><h5>Daily New Confirmed Count per 10K Pop:</h5></td><td><h5>' + values.newCasesPer10k + '</h5></td>';
  text += '<tr><td><h5>Daily New Death Count:</h5></td><td><h5>' + values.newDeaths + '</h5></td>';
  text += '<tr><td><h5>Daily New Confirmed Count per 10K Pop:</h5></td><td><h5>' + values.newDeathsPer10k + '</h5></td>';
  text += '</table>';
  text += '<hr>';
  text += '<table>'
  text += '<tr><td><h5>Population:</h5></td><td><h5>' + values.population + '</h5></td>';
  text += '</table>';

  if (isLisa()) {
    let field = data_btn.innerText;
    let c = lisaData[selectedDataset][selectedDate][field].clusters[id];
    text += '<br/><div><b>' + lisa_labels[c] + '</b></div>';
    text += '<div><b>p-value:</b>' + lisaData[selectedDataset][selectedDate][field].pvalues[id] + '</div>';
    text += '<div>Queen weights and 999 permutations</div>';
  }

  return text;
}

// this is the callback for when you hover over a feature on the map
function updateTooltip(e) {
  const { x, y, object } = e;
  const tooltip = document.getElementById('tooltip');

  // if they aren't hovered over an object, empty the tooltip (this effectively)
  // hides it
  if (!object) {
    tooltip.innerHTML = '';
    return;
  }

  // source/calculate tooltip values  
  const id = object.properties.id;

  // get the state/county name
  let entityName = '';
  if ('NAME' in object.properties) {
    entityName = object.properties.NAME;
  } else {
    entityName = jsondata[selectedDataset].features[id].properties.NAME;
  }

  // get population
  const population = populationData[selectedDataset][id];
  const populationDataExists = (population && population > 0);

  // get beds
  const beds = bedsData[selectedDataset][id];
  const bedsDataExists = (beds && beds > 0);

  // cases
  let cases = caseData[selectedDataset][selectedDate][id];
  let casesPer10k = populationDataExists ? (cases / population * 10000) : 0;
  
  // deaths
  let deaths = deathsData[selectedDataset][selectedDate][id];
  let deathsPer10k = populationDataExists ? (deaths / population * 10000) : 0;
  let fatalityRate = fatalityData[selectedDataset][selectedDate][id];
  
  // new cases
  let newCases = 0;
  let dt_idx = dates[selectedDataset].indexOf(selectedDate);
  if (dt_idx > 0) {
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = caseData[selectedDataset][selectedDate];
    var pre_vals = caseData[selectedDataset][prev_date];
    newCases = cur_vals[id] - pre_vals[id];
  }
  let newCasesPer10k = populationDataExists ? (newCases / population * 10000) : 0;

  // new deaths
  let newDeaths = 0;
  if (dt_idx > 0) {
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = deathsData[selectedDataset][selectedDate];
    var pre_vals = deathsData[selectedDataset][prev_date];
    newDeaths = cur_vals[id] - pre_vals[id];
  }
  let newDeathsPer10k = populationDataExists ? (newDeaths / population * 10000) : 0;

  // cases per bed
  let casesPerBed = bedsDataExists ? (cases / beds) : 0;

  // handle decimals
  casesPer10k = parseFloat(casesPer10k).toFixed(2);
  deathsPer10k = parseFloat(deathsPer10k).toFixed(2);
  casesPerBed = parseFloat(casesPerBed).toFixed(2);
  fatalityRate = parseFloat(fatalityRate).toFixed(2);
  newCasesPer10k = parseFloat(newCasesPer10k).toFixed(2);
  newDeathsPer10k = parseFloat(newDeathsPer10k).toFixed(2);

  // render html
  const values = {
    entityName,
    cases,
    casesPer10k,
    beds,
    casesPerBed,
    deaths,
    deathsPer10k,
    fatalityRate,
    newCases,
    newCasesPer10k,
    newDeaths,
    newDeathsPer10k,
    population
  };
  const text = getTooltipHtml(values);

  // set html
  tooltip.innerHTML = text;

  // position tooltip over mouse location
  tooltip.style.top = `${y}px`;
  tooltip.style.left = `${x}px`;
}

function handleMapHover(e) {
  updateTooltip(e);
  updateDataPanel(e);
}

function updateDataPanel(e) {
  // TODO render chr data
}


/*
 * APPLICATION
*/

// set up deck/mapbox
const deckgl = new DeckGL({
  mapboxApiAccessToken: 'pk.eyJ1IjoibGl4dW45MTAiLCJhIjoiY2locXMxcWFqMDAwenQ0bTFhaTZmbnRwaiJ9.VRNeNnyb96Eo-CorkJmIqg',
  mapStyle: 'mapbox://styles/mapbox/dark-v9',
  latitude: 32.850033,
  longitude: -86.6500523,
  zoom: 3.5,
  maxZoom: 18,
  pitch: 0,
  controller: true,
  onViewStateChange: (view) => {
    current_view = view.viewState;
  },
  layers: []
});

const mapbox = deckgl.getMapboxMap();

mapbox.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

mapbox.on('zoomend', () => {
  const currentZoom = mapbox.getZoom();
  let lat = current_view == null ? deckgl.viewState.latitude : current_view.latitude;
  let lon = current_view == null ? deckgl.viewState.longitude : current_view.longitude;
  deckgl.setProps({
    viewState: {
      zoom: currentZoom,
      latitude: lat,
      longitude: lon
    }
  });
});

function resetView(layers) {
  deckgl.setProps({
    layers: layers,
    viewState: {
      zoom: 3.5,
      latitude: 32.850033,
      longitude: -86.6500523,
      transitionInterpolator: new LinearInterpolator(['bearing']),
      transitionDuration: 500
    }
  });
}

function setCartogramView(layers) {
  if (isState()) {
    deckgl.setProps({
      layers: layers,
      viewState: {
        zoom: 6.6,
        latitude: 3.726726,
        longitude: -8.854194,
        transitionInterpolator: new LinearInterpolator(['bearing']),
        transitionDuration: 500
      }
    });
  } else {
    deckgl.setProps({
      layers: layers,
      viewState: {
        zoom: 5.6,
        latitude: 13.510908,
        longitude: -28.190367,
        transitionInterpolator: new LinearInterpolator(['bearing']),
        transitionDuration: 500
      }
    });
  }
}

function createMap(data) {
  if (selectedDate == null)
    selectedDate = dates[selectedDataset][dates[selectedDataset].length - 1];

  var labels = [];
  var cents = centroids[selectedDataset];
  console.log("centroids from :", selectedDataset);

  if (isLisa()) {
    for (let i = 0; i < data.features.length; ++i) {
      let json = selectedDataset;
      //if (json == "county") {
      let field = data_btn.innerText;
      let c = lisaData[json][selectedDate][field].clusters[i];
      if (c == 1)
        labels.push({
          id: i,
          position: cents[i],
          text: data.features[i].properties.NAME
        });
      //}
    }
  }

  var layers = [];

  if (isCartogram()) {
    mapbox.getCanvas().hidden = true;
    if ('name' in data && data.name.startsWith("state")) {
      for (let i = 0; i < data.features.length; ++i) {
        labels.push({
          id: i,
          position: cartogramData[i].position,
          text: data.features[i].properties.NAME
        });
      }
    }
    layers.push(
      new ScatterplotLayer({
        data: cartogramData,
        getPosition: d => d.position,
        getFillColor: getFillColor,
        getLineColor: getLineColor,
        getRadius: d => d.radius * 10,
        onHover: updateTooltip,
        onClick: updateTrendLine,
        pickable: true,
        updateTriggers: {
          getLineColor: [
            selectedId
          ],
          getFillColor: [
            selectedDate, selectedVariable, selectedMethod
          ]
        },
      })
    );
    layers.push(
      new TextLayer({
        data: labels,
        pickable: true,
        getPosition: d => d.position,
        getText: d => d.text,
        getSize: 12,
        fontFamily: 'Gill Sans Extrabold, sans-serif',
        getTextAnchor: 'middle',
        getAlignmentBaseline: 'bottom',
        getColor: [20, 20, 20]
      })
    );
    setCartogramView(layers);

  } else {
    mapbox.getCanvas().hidden = false;
    layers.push(
      new GeoJsonLayer({
        id: 'map-layer',
        data: data,
        opacity: 0.5,
        stroked: true,
        filled: true,
        //wireframe: true,
        //fp64: true,
        lineWidthScale: 1,
        lineWidthMinPixels: 1,
        getElevation: getElevation,
        getFillColor: getFillColor,
        getLineColor: getLineColor,

        updateTriggers: {
          getLineColor: [],
          getFillColor: [
            selectedDate, selectedVariable, selectedMethod
          ]
        },
        pickable: true,
        onHover: handleMapHover,
        onClick: updateTrendLine
      })
    );
    if (!('name' in data)) {
      layers.push(
        new GeoJsonLayer({
          data: './states.geojson',
          opacity: 0.5,
          stroked: true,
          filled: false,
          lineWidthScale: 1,
          lineWidthMinPixels: 1.5,
          getLineColor: [220, 220, 220],
          pickable: false
        })
      );
    }

    if (shouldShowLabels) {
      layers.push(
        new TextLayer({
          data: labels,
          pickable: true,
          getPosition: d => d.position,
          getText: d => d.text,
          getSize: 18,
          fontFamily: 'Gill Sans Extrabold, sans-serif',
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'bottom',
          getColor: [250, 250, 250],
          fontSettings: {
            buffer: 20,
            sdf: true,
            radius: 6
          }
        })
      );
    }
    resetView(layers);
  }

  if (document.getElementById('linechart').innerHTML == "" ||
    d3.select("#slider").node().max != dates[selectedDataset].length) {
    addTrendLine(data, "");
  } else {
    updateTrendLine({
      x: 0,
      y: 0,
      object: null
    });
  }

  createTimeSlider(data);
}

function loadMap() {
  createMap(jsondata[selectedDataset]);
}

function getElevation(f) {
  return f.properties.id == selectedId ? 90000 : 1;
}

// TODO move to utils or data loading section
function assignIdsToFeatures(features) {
  for (let i = 0; i < features.features.length; i++) {
    // Track each feature individually with a unique ID.
    features.features[i].properties.id = i;
  }
  return features;
}

// TODO move to state section
function GetFeatureValue(id) {
  let json = selectedDataset;
  let txt = data_btn.innerText;
  if (txt == "Confirmed Count") {
    return caseData[json][selectedDate][id];
  } else if (txt == "Confirmed Count per 10K Population") {
    if (populationData[json][id] == undefined || populationData[json][id] == 0) return 0;
    return (caseData[json][selectedDate][id] / populationData[json][id] * 10000).toFixed(3);
  } else if (txt == "Confirmed Count per Licensed Bed") {
    if (bedsData[json][id] == undefined || bedsData[json][id] == 0) return 0;
    return (caseData[json][selectedDate][id] / bedsData[json][id]).toFixed(3);
  } else if (txt == "Death Count") {
    return deathsData[json][selectedDate][id];
  } else if (txt == "Death Count per 10K Population") {
    if (populationData[json][id] == undefined || populationData[json][id] == 0) return 0;
    return (deathsData[json][selectedDate][id] / populationData[json][id] * 10000).toFixed(3);
  } else if (txt == "Death Count/Confirmed Count") {
    return fatalityData[json][selectedDate][id];
  } else if (txt == "Daily New Confirmed Count") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return 0;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = caseData[json][selectedDate];
    var pre_vals = caseData[json][prev_date];
    return cur_vals[id] - pre_vals[id];

  } else if (txt == "Daily New Confirmed Count per 10K Pop") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return 0;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = caseData[json][selectedDate];
    var pre_vals = caseData[json][prev_date];
    return ((cur_vals[id] - pre_vals[id]) / populationData[json][id] * 10000).toFixed(3);

  } else if (txt == "Daily New Death Count") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return 0;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = deathsData[json][selectedDate];
    var pre_vals = deathsData[json][prev_date];
    return cur_vals[id] - pre_vals[id];

  } else if (txt == "Daily New Death Count per 10K Pop") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return 0;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = deathsData[json][selectedDate];
    var pre_vals = deathsData[json][prev_date];
    return ((cur_vals[id] - pre_vals[id]) / populationData[json][id] * 10000).toFixed(3);
  }
  return 0;
}

function GetDataValues() {
  let json = selectedDataset;
  let txt = data_btn.innerText;
  if (txt == "Confirmed Count") {
    return Object.values(caseData[json][selectedDate]);
  } else if (txt == "Confirmed Count per 10K Population") {
    var vals = [];
    for (var id in caseData[json][selectedDate]) {
      if (populationData[json][id] == undefined || populationData[json][id] == 0)
        vals.push(0);
      else
        vals.push(caseData[json][selectedDate][id] / populationData[json][id] * 10000);
    }
    return vals;

  } else if (txt == "Confirmed Count per Licensed Bed") {
    var vals = [];
    for (var id in caseData[json][selectedDate]) {
      if (bedsData[json][id] == undefined || bedsData[json][id] == 0)
        vals.push(0);
      else
        vals.push(caseData[json][selectedDate][id] / bedsData[json][id]);
    }
    return vals;

  } else if (txt == "Death Count") {
    return Object.values(deathsData[json][selectedDate]);
  } else if (txt == "Death Count per 10K Population") {
    var vals = [];
    for (var id in deathsData[json][selectedDate]) {
      if (populationData[json][id] == undefined || populationData[json][id] == 0)
        vals.push(0);
      else
        vals.push(deathsData[json][selectedDate][id] / populationData[json][id] * 10000);
    }
    return vals;
  } else if (txt == "Death Count/Confirmed Count") {
    return Object.values(fatalityData[json][selectedDate]);
  } else if (txt == "Daily New Confirmed Count") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = caseData[json][selectedDate];
    var pre_vals = caseData[json][prev_date];
    var rt_vals = [];
    for (let i in cur_vals) {
      rt_vals.push(cur_vals[i] - pre_vals[i]);
    }
    return rt_vals;

  } else if (txt == "Daily New Confirmed Count per 10K Pop") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return 0;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = caseData[json][selectedDate];
    var pre_vals = caseData[json][prev_date];
    var rt_vals = [];
    for (let i in cur_vals) {
      rt_vals.push((cur_vals[i] - pre_vals[i]) / populationData[json][i] * 10000);
    }
    return rt_vals;

  } else if (txt == "Daily New Death Count") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return 0;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = deathsData[json][selectedDate];
    var pre_vals = deathsData[json][prev_date];
    var rt_vals = [];
    for (let i in cur_vals) {
      rt_vals.push(cur_vals[i] - pre_vals[i]);
    }
    return rt_vals;

  } else if (txt == "Daily New Death Count per 10K Pop") {
    let dt_idx = dates[selectedDataset].indexOf(selectedDate);
    if (dt_idx == 0) return 0;
    let prev_date = dates[selectedDataset][dt_idx - 1];
    var cur_vals = deathsData[json][selectedDate];
    var pre_vals = deathsData[json][prev_date];
    var rt_vals = [];
    for (let i in cur_vals) {
      rt_vals.push((cur_vals[i] - pre_vals[i]) / populationData[json][i] * 10000);
    }
    return rt_vals;
  }
}

function UpdateLegend() {
  const div = document.getElementById('legend');
  div.innerHTML = `<div class="legend" style="background: rgb(240, 240, 240); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(255, 237, 160); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(254, 217, 118); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(254, 178, 76); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(253, 141, 60); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(252, 78, 42); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(227, 26, 28); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(189, 0, 38); width: 7.69231%;"></div>
    <div class="legend" style="background: rgb(128, 0, 38); width: 7.69231%;"></div>
`;
}

function UpdateLegendLabels(breaks) {
  let field = data_btn.innerText;
  const div = document.getElementById('legend-labels');
  var cont = '<div style="width: 7.69231%;text-align:center">0</div>';
  for (var i = 0; i < breaks.length; ++i) {
    let val = breaks[i];
    if (field == "Death Count/Confirmed Count") {
      cont += '<div style="width: 7.69231%;text-align:center">' + val + '</div>';
    } else {
      if (val[0] == '>') {
        val = val.substring(1, val.length);
        if (val.indexOf('.') >= 0) {
          // format float number
          val = parseFloat(val);
          val = val.toFixed(2);
        } else {
          val = parseInt(val);
          if (val > 10000) val = d3.format(".2s")(val);
        }
        cont += '<div style="width: 7.69231%;text-align:center">>' + val + '</div>';
      } else {
        if (val.indexOf('.') >= 0) {
          // format float number
          val = parseFloat(val);
          val = val.toFixed(2);
        } else {
          val = parseInt(val);
          if (val > 10000) val = d3.format(".2s")(val);
        }
        cont += '<div style="width: 7.69231%;text-align:center">' + val + '</div>';
      }
    }
  }
  div.innerHTML = cont;
}

function UpdateLisaLegend(colors) {
  const div = document.getElementById('legend');
  var cont = '<div class="legend" style="background: #eee; width: 20%;"></div>';
  for (var i = 1; i < colors.length; ++i) {
    cont += '<div class="legend" style="background: ' + colors[i] + '; width: 20%;"></div>';
  }
  div.innerHTML = cont;
}

function UpdateLisaLabels(labels) {
  const div = document.getElementById('legend-labels');
  var cont = '<div style="width: 20%;text-align:center">Not Sig</div>';
  for (var i = 1; i < 5; ++i) {
    cont += '<div style="width: 20%;text-align:center">' + labels[i] + '</div>';
  }
  div.innerHTML = cont;
}

function OnChoroplethClick(evt) {
  selectedMethod = "choropleth";
  if (isState()) {
    OnStateClick();
  } else {
    OnCountyClick();
  }
}

function OnLISAClick(evt) {
  selectedMethod = "lisa";

  var w = getCurrentWuuid();
  var data = GetDataValues();
  let field = data_btn.innerText;
  let json = selectedDataset;
  var color_vec = lisa_colors;
  var labels = lisa_labels;
  var clusters;
  var sig;

  if (!(json in lisaData)) lisaData[json] = {};

  if (selectedDate in lisaData[json] && field in lisaData[json][selectedDate]) {
    clusters = lisaData[json][selectedDate][field].clusters;
    sig = lisaData[json][selectedDate][field].sig;

  } else {
    var lisa = gda_proxy.local_moran1(w.map_uuid, w.w_uuid, data);
    clusters = gda_proxy.parseVecDouble(lisa.clusters());
    sig = gda_proxy.parseVecDouble(lisa.significances());
    if (!(selectedDate in lisaData[json])) lisaData[json][selectedDate] = {}
    if (!(field in lisaData[json][selectedDate])) lisaData[json][selectedDate][field] = {}
    lisaData[json][selectedDate][field]['clusters'] = clusters;
    lisaData[json][selectedDate][field]['pvalues'] = sig;
  }

  color_vec[0] = '#ffffff';

  getFillColor = function(f) {
    var c = clusters[f.properties.id];
    if (c == 0) return [255, 255, 255, 200];
    return hexToRgb(color_vec[c]);
  };

  getLineColor = function(f) {
    return f.properties.id == selectedId ? [255, 0, 0] : [255, 255, 255, 50];
  };

  UpdateLisaLegend(color_vec);
  UpdateLisaLabels(labels);

  evt.classList.add("checked");
  document.getElementById("btn-nb").classList.remove("checked");

  if (isState()) {
    loadMap(stateMap);
  } else {
    loadMap(countyMap);
  }
}

function loadScript(url) {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url;
  const head = document.querySelector('head');
  head.appendChild(script);
  return new Promise(resolve => {
    script.onload = resolve;
  });
}

function getConfirmedCountByDateState(data, state) {
  var features = data['features'];
  var dates = getDatesFromGeojson(data);
  var counts = 0;
  var sel_dt = Date.parse(selectedDate);
  for (var j = 0; j < features.length; ++j) {
    if (features[j]["properties"]["STUSPS"] == state) {
      for (var i = 0; i < dates.length; ++i) {
        var d = Date.parse(dates[i]);
        if (d <= sel_dt) {
          counts += features[j]["properties"][dates[i]];
        }
      }
      break;
    }
  }
  return counts;
}

function getConfirmedCountByDateCounty(county_id, all) {
  let json = selectedDataset;
  let n_count = Object.keys(caseData[json][selectedDate]).length;
  var counts = [];
  let d = dates[selectedDataset][0];
  let sum = 0;
  let sel_dt = Date.parse(selectedDate);

  if (all || Date.parse(d) <= sel_dt) {
    sum = caseData[json][d][county_id];
  }
  counts.push(sum);
  for (let i = 1; i < dates[selectedDataset].length; ++i) {
    let sum = 0;
    let d0 = dates[selectedDataset][i - 1];
    let d1 = dates[selectedDataset][i];
    if (all || Date.parse(d1) <= sel_dt) {
      sum = (caseData[json][d1][county_id] - caseData[json][d0][county_id]);
    }
    if (sum < 0) {
      console.log("USAFacts data issue at ", jsondata[json].features[county_id].properties.NAME);
      sum = 0;
    }
    counts.push(sum);
  }
  return counts;
}

function getConfirmedCountByDate(data, all) {
  let json = selectedDataset;
  let n_count = Object.keys(caseData[json][selectedDate]).length;
  var counts = [];
  let d = dates[selectedDataset][0];
  // get total count for 1st day
  let sum = 0;
  let sel_dt = Date.parse(selectedDate);
  for (let j = 0; j < n_count; ++j) {
    if (all || Date.parse(d) <= sel_dt) {
      sum = caseData[json][d][j];
    }
  }
  counts.push(sum);
  for (let i = 1; i < dates[selectedDataset].length; ++i) {
    let pre_sum = 0;
    let cur_sum = 0;
    let d0 = dates[selectedDataset][i - 1];
    let d1 = dates[selectedDataset][i];
    if (all || Date.parse(d1) <= sel_dt) {
      for (let j = 0; j < n_count; ++j) {
        pre_sum += caseData[json][d0][j];
        cur_sum += caseData[json][d1][j];
      }
    }
    counts.push(cur_sum - pre_sum < 0 ? 0 : cur_sum - pre_sum);
  }
  return counts;
}

function getAccumConfirmedCountByDate(data, all) {
  var counts = getConfirmedCountByDate(data, all);
  for (var i = 1; i < counts.length; ++i) {
    counts[i] = counts[i - 1] + counts[i];
  }
  return counts;
}

// following code are for LINE CHART
function addTrendLine(data, title) {
  var height = 140;
  var width = 290;
  var margin = {
    top: 10,
    right: 20,
    bottom: 50,
    left: 50
  };

  d3.select("#linechart svg").remove();

  var svg = d3.select("#linechart")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .attr("transform", "translate(0," + margin.top + ")");

  svg.append("g").attr("class", "y axis");
  svg.append("g").attr("class", "x axis");

  var xScale = d3.scaleBand().range([margin.left, width], .1);
  var yScale = d3.scaleLinear().range([height, 10]);
  var xAxis = d3.axisBottom().scale(xScale);
  var yAxis = d3.axisLeft().scale(yScale);

  // extract the x labels for the axis and scale domain
  var xLabels = dates[selectedDataset];
  xScale.domain(xLabels);

  var yValues = getConfirmedCountByDate(data, false);
  yScale.domain([0, Math.max.apply(null, yValues)]);

  var tmpData = [];
  for (var i = 0; i < xLabels.length; ++i) {
    tmpData.push({
      "date": xLabels[i],
      "confirmedcases": yValues[i]
    });
  }
  var line = d3.line()
    .x(function(d) {
      return xScale(d['date']);
    })
    .y(function(d) {
      return yScale(d['confirmedcases']);
    });

  svg.append("path")
    .datum(tmpData)
    .attr("class", "line")
    .attr("d", line);

  svg.append("g")
    .attr("transform", "translate(0," + (height) + ")")
    .call(xAxis.tickValues(xLabels.filter(function(d, i) {
      if (i % 4 == 0)
        return d;
    })).tickFormat(function(e) {
      let d = new Date(e);
      let mo = new Intl.DateTimeFormat('en', {
        month: '2-digit'
      }).format(d)
      let da = new Intl.DateTimeFormat('en', {
        day: '2-digit'
      }).format(d)
      return da + '-' + mo;
    }))
    .selectAll("text")
    .style("text-anchor", "end")
    .attr("class", "xaxis")
    .attr("transform", function(d) {
      return "rotate(-45)";
    });

  svg.append("g")
    .attr("transform", "translate(" + (margin.left) + ",0)")
    .attr("class", "yaxis")
    .call(yAxis.tickFormat(function(e, i) {
      if (i % 2 == 1 || Math.floor(e) != e)
        return;
      return d3.format(",")(e);
    }));


  // chart title
  svg.append("text")
    .attr("class", "linetitle")
    .attr("x", (width + (margin.left + margin.right)) / 2)
    .attr("y", 0 + margin.top)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("font-family", "sans-serif")
    .text(title);
}

// ** Update data section (Called from the onclick)
function updateTrendLine({
  x,
  y,
  object
}) {
  var height = 140;
  var width = 290;
  var margin = {
    top: 10,
    right: 20,
    bottom: 50,
    left: 50
  };
  var xLabels, yValues, title;
  let json = selectedDataset;

  xLabels = dates[selectedDataset];
  if (object) {
    yValues = getConfirmedCountByDateCounty(object.properties.id, false);
  } else {
    yValues = getConfirmedCountByDate(jsondata[json], false);
  }
  title = object ? object.properties["NAME"] : "all";

  // Get the data again
  var tmpData = [];
  for (var i = 0; i < xLabels.length; ++i) {
    tmpData.push({
      "date": xLabels[i],
      "confirmedcases": yValues[i]
    });
  }

  var xScale = d3.scaleBand()
    .range([margin.left, width], .1);

  var yScale = d3.scaleLinear()
    .range([height, 10]);

  // Scale the range of the data again 
  xScale.domain(xLabels);
  yScale.domain([0, Math.max.apply(null, yValues)]);

  // Select the section we want to apply our changes to
  var svg = d3.select("#linechart svg").transition();

  var line = d3.line()
    .x(function(d) {
      return xScale(d['date']);
    })
    .y(function(d) {
      return yScale(d['confirmedcases']);
    });

  var xAxis = d3.axisBottom()
    .scale(xScale);

  var yAxis = d3.axisLeft()
    .scale(yScale);

  // Make the changes
  svg.select(".line") // change the line
    .duration(750)
    .attr("d", line(tmpData));
  svg.select(".yaxis") // change the y axis
    .duration(750)
    .call(yAxis);
  svg.select(".xaxis") // change the y axis
    .duration(750)
    .call(xAxis);

  svg.select(".linetitle")
    .text(title);
}

function createTimeSlider(geojson) {
  if (document.getElementById("slider-svg").innerHTML.length > 0) {
    if (d3.select("#slider").node().max != dates[selectedDataset].length) {
      d3.select("#slider-svg").select("svg").remove();
    } else {
      return;
    }
  }

  var width = 320,
    height = 180,
    padding = 28;

  var svg = d3.select("#slider-svg")
    .append("svg")
    .attr("width", width + padding * 2)
    .attr("height", height);

  var xScale = d3.scaleBand()
    .range([padding, width], .1);

  var yScale = d3.scaleLinear()
    .range([height - padding, padding]);

  var xLabels = dates[selectedDataset];
  xScale.domain(xLabels);

  d3.select("#slider").node().max = xLabels.length;
  d3.select("#slider").node().value = xLabels.length;

  var yValues = getAccumConfirmedCountByDate(geojson, true);
  yScale.domain([0, Math.max.apply(null, yValues)]);

  var tmpData = [];
  for (var i = 0; i < xLabels.length; ++i) {
    tmpData.push({
      "date": xLabels[i],
      "confirmedcases": yValues[i]
    });
  }

  var bars = svg.selectAll(".bars")
    .data(tmpData)
    .enter()
    .append("rect")
    .attr("x", d => xScale(d.date))
    .attr("width", xScale.bandwidth() - 1)
    .attr("y", d => yScale(d.confirmedcases))
    .attr("height", d => height - padding - yScale(d.confirmedcases))
    .text("1")
    .attr("fill", (d => xLabels[d3.select("#slider").node().value - 1] == d.date ? "red" : "gray"));
  var xAxis = d3.axisBottom(xScale);
  var yAxis = d3.axisRight(yScale);

  //var gX = svg.append("g")
  //    .attr("transform", "translate(0," + (height - padding) + ")")
  //    .call(xAxis);

  var gY = svg.append("g")
    .attr("class", "axis--y")
    .attr("transform", "translate(" + (width) + ",0)")
    .call(yAxis.tickFormat(function(e, i) {
      if (i % 2 == 1)
        return;
      return d3.format(",")(e);
    }));

  svg.append("text")
    .attr("transform", "translate(" + (width / 2) + "," + 0 + ")")
    .attr("dy", "1em")
    .attr("class", "slider_text")
    .attr("text-anchor", "end")
    .style("fill", "gray")
    .html(selectedDate);

  d3.select("#slider").on("input", function() {
    var currentValue = parseInt(this.value);
    selectedDate = dates[selectedDataset][currentValue - 1];
    console.log(selectedDate);

    document.getElementById('time-container').innerText = selectedDate;
    var xLabels = dates[selectedDataset];
    xScale.domain(xLabels);

    var yValues = getAccumConfirmedCountByDate(geojson, true);
    yScale.domain([0, Math.max.apply(null, yValues)]);

    bars.attr("y", d => yScale(d.confirmedcases))
      .attr("height", d => height - padding - yScale(d.confirmedcases))
      .attr("fill", (d => xLabels[currentValue - 1] == d.date ? "red" : "gray"));

    d3.select(".slider_text")
      .html(selectedDate);

    //gY.call(yAxis);
    if (isLisa()) {
      OnLISAClick(document.getElementById('btn-lisa'));
    } else {
      if (isState()) {
        OnStateClick();
      } else {
        OnCountyClick();
      }
    }
  })
}

d3.json("lisa_dates.json", function(ds) {
  // load lisa from cache
  if (!('county_usfacts.geojson' in lisaData))
    lisaData['county_usfacts.geojson'] = {};

  setTimeout(function() {
    for (let i = 0; i < ds.length; ++i) {
      let d = ds[i];
      let d_fn = d.replace(/\//g, '_');
      d3.json("lisa/lisa" + d_fn + '.json', function(data) {
        if (data != null) {
          lisaData['county_usfacts.geojson'][d] = data;
        }
      });
    }
  }, 5000); // download cached files after 5 seconds;
})


/*
 * ENTRY POINT
*/
var Module = {
  onRuntimeInitialized: function () {
    gda_proxy = new GeodaProxy();
    OnCountyClick();
  }
};
