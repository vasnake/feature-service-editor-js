/**
 * Library for rapid, table-based editing of a point-based ArcGIS FeatureServices.
 * With this library you can search, modify, add or delete points.
 * This functionality can be wired into a map.
 *
 * Tested, fixed and adopted by Valentin Fedulov <vasnake@gmail.com>
 *
 * @author Andy Gup
 * @version 0.7.2
 * @type {Object} featureEditor Class.
 * @author vasnake@gmail.com
 */
var featureEditor = featureEditor || {};

/**
 * Local ENUMs (Constants)
 * @type {Object}
 * @returns {*}
 */
featureEditor.localEnum = (function(){
    var values = {
        RECORDS_PER_PAGE:       15,
        HTTP_REQUEST_TIMEOUT:   30000,
        PREVENT_OBJECTID_EDIT:  true,
        TYPE:                   "type" /* featureService field type property */,
        OUTFIELDS:              "*" /* outField property for FeatureLayer and Query */
    };
    return values;
});

featureEditor.pageInfo = {
    objectIds:      null,
    totalRecords:   0,
    totalPages:     0,
    currentPage:    0,
    recordsPerPage: featureEditor.localEnum().RECORDS_PER_PAGE
};

featureEditor.utils = {};
featureEditor.ui = {};
featureEditor.grid = null;
featureEditor.query = null; // esri/tasks/query
featureEditor.addGrid = null;
featureEditor.columnNamesArr = [];
featureEditor.store = null;
featureEditor.addStore = null;
featureEditor.currentRecord = null;
featureEditor.currentAddRecord = null;
featureEditor.currentAddRow = null;
featureEditor.featureLayer = null;
featureEditor.masterRecordArr = []; // data fetched from feature layer
featureEditor.restEndpoint = null;
featureEditor.dgridRowClickListener = null;
featureEditor.dgridCellDblClickListener = null;
featureEditor.dgridAddCellClickListener = null;
featureEditor.outFields = null;
featureEditor.loadingIcon = null;
featureEditor.spatialReference = null;
featureEditor.xField = null; //internal - field string name containing x geometry value
featureEditor.yField = null; //internal - field string name containing y geometry value;
featureEditor.rowOnClick = null; // dGrid row onClick external callback
featureEditor.cellOnDblClick = null; // dGrid cell onDblClick external callback

/**
 * An array of the editable fields within the featureLayer.
 * By default, fields with the property editable = false are automatically excluded.
 * @type {Array}
 */
featureEditor.featureEditDetails = [];

require([
    'dojo/_base/declare',
    "esri/layers/FeatureLayer",
    "esri/tasks/query",
    "dijit/form/Button",
    "dijit/form/ComboBox",
    "dojo/number",
    "dgrid/OnDemandGrid",
    "dgrid/Selection",
    "dgrid/extensions/ColumnHider",
    "dgrid/extensions/ColumnResizer",
    "dgrid/CellSelection",
    "dgrid/util/mouse",
    "dgrid/Keyboard",
    "dgrid/editor",
    "dojo/store/Memory",
    "dojo/on",
    "dojo/when",
    "dojo/request",
    "dojo/query",
    "dojo/Deferred",
    "dojox/widget/Standby",
    "dojo/domReady!",
    "dojox/json/ref"],
    function(declare, FeatureLayer, Query, Button, ComboBox, number, OnDemandGrid, ColumnHider, ColumnResizer,
        Selection, CellSelection, mouseUtil, Keyboard, editor, Memory, on, when, request, query, Deferred, Standby) {

    /**
     * Button 'Load' onClick handler.
     * Load/reload data from FS layer (feature class) to grid.
     * @param fcUrl feature server layer url like "http://cgis.allgis.org/arcgis/rest/services/somename/FeatureServer/0"
     * @param qString sql where clause like "objectid='1'"
     * @param pageNum page number for load to grid
     * @param rowsPerPage number of rows in grid
     */
    featureEditor.load = function(fcUrl, qString, pageNum, rowsPerPage) {
        console.log("featureEditor.load. fcUrl, qString, pageNum, rowsPerPage: ", arguments);

        // destroy grid
        if(featureEditor.dgridRowClickListener != null) featureEditor.dgridRowClickListener.remove();
        if(featureEditor.dgridCellDblClickListener != null) featureEditor.dgridCellDblClickListener.remove();
        featureEditor.dgridRowClickListener = null;
        featureEditor.dgridCellDblClickListener = null;

        if(featureEditor.grid) {
            featureEditor.loadingIcon.destroy();
            featureEditor.grid.revert();
            featureEditor.grid.destroy();
            featureEditor.grid = null;
            dojo.place('<div id="grid" class="grid1"></div>', 'grid-legend-parent', 'before');
        }

        this.featureEditDetails = [];

        // check parameters
        fcUrl = fcUrl || this.restEndpoint;
        if(!featureEditor.utils.validateURL(fcUrl)) {
            alert("Invalid feature layer URL. \n Valid URL looks like 'http://somehostFQDN/arcgis/rest/services/somename/FeatureServer/0'");
            return;
        }
        featureEditor.restEndpoint = fcUrl;

        // TODO: another parameter
        //featureEditor.outFields = dojo.byId("outfields-string").value;
        featureEditor.outFields = featureEditor.localEnum().OUTFIELDS;
        if(featureEditor.outFields == "") featureEditor.outFields = "*";

        pageNum = pageNum || this.pageInfo.currentPage;
        if(pageNum <= 0) pageNum = 1;
        rowsPerPage = rowsPerPage || this.pageInfo.recordsPerPage;
        this.pageInfo.currentPage = pageNum;
        this.pageInfo.recordsPerPage = rowsPerPage;

        dojo.byId("grid").style.visibility = "visible";
        featureEditor.loadingIcon = featureEditor.utils._createStandbyIcon("grid");
        featureEditor.loadingIcon.show();

        this.query = new Query();
        query.where = qString || "1=1";

        // ask for featureLayer IDs
        featureEditor.featureLayer = new FeatureLayer(
            fcUrl,
            {outFields: [featureEditor.outFields]}
        );

        var deferred = featureEditor.featureLayer.queryIds(query,
            function (/* array */ objectIds) {
                console.log("queryIds. objectIds: ", objectIds);
                if(objectIds.length > 0) {
                    featureEditor._fetchRecords(objectIds);
                } else {
                    alert("No results found.");
                }
            },
            function(err) {
                console.log("queryIds: Error: " + err.code + ", " + err.details[0], err);
                alert("No results found, request failed: " + err.details[0]);
            }
        ); // featureLayer.queryIds deferred

        deferred.then(dojo.hitch(this,
            function() {
                featureEditor.loadingIcon.hide();
                //Create a simple array of field names that are editable
                console.debug("featureEditor.featureLayer.fields", featureEditor.featureLayer.fields);
                var flds = featureEditor.featureLayer.fields;
                for(var key in flds) {
                    if(flds[key].editable == true) {
                        this.featureEditDetails.push(flds[key].name);
                    }
                }
            }
        )); // featureLayer.queryIds deferred.then
    }; // featureEditor.load


    /**
     * DEPRECATED
     * Begin by initializing the library here.
     * <b>IMPORTANT:</b> This app uses a stand-alone FeatureService that is not
     * associated with a map. You can modify this app to use an existing Feature Service
     * within your mapping application.
     * @param useQueryString use any user input into the query string text box otherwise ignore
     */
    featureEditor.init = function(/* boolean */ useQueryString) {
        console.log("featureEditor.init. useQueryString: ", useQueryString);

        // redirect to new load method
        try {
            var queryString = document.getElementById("query-string").value;
            var url = document.getElementById("fsEndpoint").value;
            this.load(url, queryString);
        } catch(ex) {
            console.log("Error in featureEditor.init. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
        return;

        dojo.byId("grid").style.visibility = "visible";

        featureEditor.loadingIcon = featureEditor.utils._createStandbyIcon("grid");
        featureEditor.loadingIcon.show();

        //Attempt a soft reset of grid data without having to recreate from scratch.
        if(featureEditor.grid != null) {
            featureEditor.grid.store.setData({});
            featureEditor.grid.refresh();
            featureEditor.pageInfo = null;
            featureEditor.grid = null;
            featureEditor.columnNamesArr = [];
            featureEditor.pageInfo = null;
            featureEditor.store = null;
            featureEditor.addStore = null;
            featureEditor.currentRecord = null;
            featureEditor.currentAddRow = null;
            featureEditor.featureLayer = null;
            featureEditor.masterRecordArr = [];
            featureEditor.restEndpoint = null;
            featureEditor.dgridAddCellClickListener = null;
            featureEditor.spatialReference = null;
            featureEditor.xField = null;
            featureEditor.yField = null;
        }

        if(featureEditor.dgridRowClickListener != null)
            featureEditor.dgridRowClickListener.remove();
        if(featureEditor.dgridCellDblClickListener != null)
            featureEditor.dgridCellDblClickListener.remove();

        //If the add new feature grid is visible then shut it down
        if(featureEditor.addGrid != null) {
            featureEditor.addGrid.store.setData({});
            featureEditor.addGrid.refresh();
            featureEditor.addGrid = null;
            featureEditor.ui.handleAddRecord(true);
            featureEditor.ui.handleAddRemoveEditGrid(false);
        }

        var isURLvalid = featureEditor.utils.validateURL(url);

        //Currently the outfield property is locked to return all fields.
        //So the capability to modify it has been commented out.
        //featureEditor.outFields = dojo.byId("outfields-string").value;
        featureEditor.outFields = featureEditor.localEnum().OUTFIELDS;

        //Check for blank queryString
        if(featureEditor.outFields == "") featureEditor.outFields = "*";
        if(queryString == "" || useQueryString == false)queryString = "1=1";

        if(typeof(dojo) !== "undefined" && isURLvalid) {
            featureEditor.restEndpoint = url;
            featureEditor.featureLayer = new FeatureLayer(document.getElementById("fsEndpoint").value, {
                outFields:[featureEditor.outFields]
            });

            var query = new Query();
            query.where = queryString;
            //query.timeExtent = new esri.TimeExtent(new Date("01/01/2007 UTC"));

            var deferred = featureEditor.featureLayer.queryIds(query,
                function (/* array */ objectIds) {
                    if(objectIds.length > 0){
                        featureEditor._fetchRecords(objectIds);
                    }
                    else{
                        alert("No results found.");
                        featureEditor.loadingIcon.hide();
                    }
                },
                function(err) {
                    featureEditor.loadingIcon.hide();
                    console.log("queryIds: Error: " + err.code + ", " + err.details[0]);
                    alert("No results found. " + err.details[0]);
                }
            );

            deferred.then(dojo.hitch(window,function(){
                //Create a simple array of field names that are editable
                for(var item in featureEditor.featureLayer.fields){
                    try{
                        var editable = featureEditor.featureLayer.fields[parseFloat(item)].editable;
                        var name = featureEditor.featureLayer.fields[parseFloat(item)].name;

                        var lcName = name.toLowerCase();
                        //Get the names of the fields corresponding to x and y.
                        //This could be problematic if someone uses x or y in the first part of the field name
                        if(lcName.indexOf("x") != -1 && lcName.substring(0,1) == "x") featureEditor.xField = name;
                        if(lcName.indexOf("y") != -1 && lcName.substring(0,1) == "y") featureEditor.yField = name;

                        if(editable == true){
                            featureEditor.featureEditDetails.push(name);
                        }
                    }
                    catch(err){
                        console.log("init: " + err.message);
                    }
                }
            }));

        } // if(typeof(dojo) !== "undefined" && isURLvalid) {
        else{
            alert("Feature Service URL is not valid");
        }
    }; // featureEditor.init


    /**
     * Determines whether or not to fetch records obtained via a queryIds request.
     * @param objectIds
     * @private
     */
    featureEditor._fetchRecords = function(objectIds) {
        console.log("featureEditor._fetchRecords. objectIds: ", arguments);
        if (objectIds.length > 0) {
            featureEditor._updatePageInformation(objectIds);
            featureEditor.queryRecordsByPage(this.pageInfo.currentPage);
        } else {
            alert("No record found.");
        }
    }; // featureEditor._fetchRecords


    featureEditor._updatePageInformation = function(objectIds) {
        console.log("featureEditor._updatePageInformation. objectIds, page: ", arguments);
        var pi = this.pageInfo;
        pi.objectIds = objectIds;
        pi.totalRecords = objectIds.length;
        pi.totalPages = Math.ceil(pi.totalRecords / pi.recordsPerPage);
        pi.currentPage = pi.currentPage || 1;
        if(pi.currentPage >= pi.totalPages) pi.currentPage = pi.totalPages;
        try { // update html controls
            dojo.byId("pageInfo").innerHTML = pi.currentPage + "/" + pi.totalPages;
            dojo.byId("recordsInfo").innerHTML = pi.totalRecords;
        } catch(ex) {
            console.log("Error in _updatePageInformation. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
    }; // featureEditor._updatePageInformation


    /**
     * Query the remote feature service page data
     * @param pageNumber
     */
    featureEditor.queryRecordsByPage = function(/* number */ pageNumber) {
        console.log("featureEditor.queryRecordsByPage. pageNumber: ", arguments);
        var pi = this.pageInfo;
        // check if the page number is valid
        if (pageNumber < 1 || pageNumber > pi.totalPages) {
            console.log("queryRecordsbyPage: page number invalid.");
            return;
        }
        var begin = pi.recordsPerPage * (pageNumber - 1);
        var end = begin + pi.recordsPerPage;

        featureEditor.loadingIcon.show();

        // create the query
        var query = new esri.tasks.Query();
        query.objectIds = pi.objectIds.slice(begin, end);
        query.outFields = this.outFields;

        // Query for the records with the given object IDs and populate the grid
        this.featureLayer.queryFeatures(query,
            function (featureSet) {
                console.log("featureLayer.queryFeatures. featureSet: ", arguments);
                featureEditor.spatialReference = featureSet.spatialReference;

                // grid fields
                var ind = 0; // fields list index
                var arr = []; // field names
                var columnArr = []; // dgrid fields list

                for (var key in featureSet.features[0].attributes) {
                    //console.log(key); // field name
                    arr[ind] = key;

                    // find field params - alias, type
                    var fld = {};
                    for (var fidx in featureSet.fields) {
                        var f = featureSet.fields[fidx];
                        if (f.name == key) {
                            fld = f; break;
                        }
                    }

                    columnArr[ind] = {
                        label:  fld.alias || key.toString(),
                        field:  key.toString(),
                        hidden: false
                    };
                    //See if there are any editable features.
                    if(featureEditor.featureEditDetails.indexOf(key) >= 0) {
                        columnArr[ind] = editor({ // dgrid/editor
                            label:  fld.alias || key.toString(),
                            field:  key.toString(),
                            hidden: false,
                            editor: "text",
                            editOn: "dblclick"
                        });
                    }

                    ind++;
                } // for each FC attribute
                featureEditor.columnNamesArr = columnArr;
                // fill dGrid
                featureEditor.utils.updateGrid(featureSet, pageNumber, arr, columnArr);
                featureEditor.loadingIcon.hide();
            } // queryFeatures callback
        ); // this.featureLayer.queryFeatures
    }; // featureEditor.queryRecordsByPage


    /**
     * DEPRECATED
     * Adds a new record to the remote ArcGIS database.
     * IMPORTANT: this method currently only checks to see if there is a field
     * that contains a lower-case 'x' and 'y' which indicates a point-based feature service.
     * This could be problematic for some feature services that have other
     * field names containing an x and y.
     *
     * If you are reading this and having issues, please submit suggestions
     * in the Issues section of the repository!
     *
     * If you are wondering how to get access to the type definition for each field
     * see the feature services REST endpoint under the "fields" section.
     */
    featureEditor.addNewRecord = function() {
        console.log("featureEditor.addNewRecord");

        // var nameArr = [];
        var dirty = featureEditor.addGrid.dirty;
        var id = Object.keys(dirty)[0];
        console.log(dirty[id]);

        //if id is undefined it means dirty changes have been saved
        //when id='TBD' it means user has modified the new entry
        if(typeof(id) != "undefined" && id == "TBD"){
            //get object property names
            for (var item in dirty[id]){
                //nameArr.push(item);
                featureEditor.currentAddRecord[item] = dirty[id][item];
            }

            //featureEditor.currentAddRecord[nameArr[0]] = dirty[id][nameArr[0]];
            //console.log(nameArr + ", " + dirty[id][nameArr[0]]);

            try{

                var xVal = featureEditor.currentAddRecord[featureEditor.xField];
                var yVal = featureEditor.currentAddRecord[featureEditor.yField];

                //Validate that location fields contain numerical values
                if(isNaN(xVal) == true || isNaN(yVal) == true){
                    alert("Unable to update, location values aren't valid numbers");
                    return;
                }

                var sms = new esri.symbol.SimpleMarkerSymbol().setStyle(
                                esri.symbol.SimpleMarkerSymbol.STYLE_SQUARE).setColor(
                                new dojo.Color([255,0,0,0.5]));

                var pt = new esri.geometry.Point(xVal,yVal,featureEditor.spatialReference);

                var graphic = new esri.Graphic(
                        pt,
                        sms,
                        featureEditor.currentAddRecord
                );

                featureEditor.loadingIcon.show();
                featureEditor.insertNewFeature([graphic],null,true);

            }
            catch(err){
                featureEditor.loadingIcon.hide();
                alert("Unable to complete add new record. " + err.message);
            }
        }
        else{
            featureEditor.loadingIcon.hide();
            alert("Unable to complete add new record. No valid values.");
        }
    }; // featureEditor.addNewRecord


    /**
     * Updates a current existing record in the feature service.
     * NOTE: Feature must contain a valid OBJECTID field!
     */
    featureEditor.updateFeature = function(curRec) {
        try {
            featureEditor._updateRecord(curRec);
        } catch(err) {
            console.log("updateFeature fail: ", err);
            alert("Unable to complete update. \n" + err.message);
        }

    }; // featureEditor.updateFeature


    featureEditor._updateRecord = function(curRec) {
        console.log("featureEditor.updateRecord. save currentRecord: ", curRec);
        var oid = parseInt(curRec.OBJECTID, 10);

        var dirty = featureEditor.grid.dirty;
        console.debug("grid.dirty: ", featureEditor.utils.toJson(dirty));
        var hasData = false;

        // find master record
        var mrec = null;
        console.debug("featureEditor.masterRecordArr: ", featureEditor.masterRecordArr);
        for(var ind in featureEditor.masterRecordArr) {
            var mr = featureEditor.masterRecordArr[ind];
            if(mr.attributes['OBJECTID'] == oid) {
                mrec = mr;
                break;
            }
        }
        if(mrec == null) {
            alert("Unable to update feature. master record undefined");
            featureEditor.utils.revertCurrentRecord();
            return;
        }

        // copy feature data
        console.debug("copy master record data to currentRecord");
        for(var key in mrec.attributes) {
            console.debug(key, mrec.attributes[key]);
            curRec[key] = mrec.attributes[key];
        }

        // copy grid data
        for (var property in dirty) {
            if(property == oid) {
                //get object property names
                for (var item in dirty[property]) {
                    var itemVal = dirty[property][item];
                    console.debug("grid dirty data: ", item, itemVal);
                    if(curRec.hasOwnProperty(item)) {
                        hasData = true;
                        curRec[item] = itemVal;
                    }
                    else{
                        console.debug("updateRecord - property may be missing from currentRecord: ", item);
                        if(featureEditor.utils.strStartsWith(item, "_")) {
                            console.debug("skip protected '_*'");
                        } else {
                            hasData = true;
                            console.debug("add new attrib");
                            curRec[item] = itemVal;
                        }
                    }
                }
                // record data copied into curRec
                break;
            }
        } // end for each key in dirty

        if(!hasData) {
            //alert("Unable to update since nothing changed");
            console.log("updateRecord: unable to update since nothing changed");
            featureEditor.utils.revertCurrentRecord();
            return;
        }

        curRec.OBJECTID = oid; // integer instead of string
        var graphic = new esri.Graphic(
            mrec.geometry,
            mrec.symbol,
            curRec,
            mrec.infoTemplate
        );
        console.debug("esri.Graphic: ", graphic);

        featureEditor.loadingIcon.show();

        featureEditor.featureLayer.applyEdits(null, [graphic], null,
            function(addResult, updateResult, deleteResult) {
                console.log("updateRecord.applyEdits.response: " + updateResult[0].objectId + ", Success: " + updateResult[0].success);
                featureEditor.grid.refresh();
                featureEditor.loadingIcon.hide();
            },
            function(error) {
                var message = "";
                if(error.code)message = error.code;
                if(error.description)message += error.description;
                console.log("updateRecord.applyEdits.error: " + error.message + ", " + message, error);
                featureEditor.grid.refresh();
                featureEditor.loadingIcon.hide();
                alert("Unable to update. " + error.message + ", " + message);
            }
        ); // applyEdits
    }; // featureEditor._updateRecord


    /**
     * DEPRECATED
     * Used to insert a new record/feature into the remote feature service.
     * @param graphic [Graphic]
     * @param token String
     * @param confirm use an alert to confirm success.
     */
    featureEditor.insertNewFeature = function(/* Array */ graphic, /* String */ token, /* boolean */ confirm) {
        console.log("featureEditor.insertNewFeature. graphic, token, confirm:", graphic, token, confirm);

        featureEditor.featureLayer.applyEdits(graphic,null,null, function(response){
            //var t = JSON.parse(response);
            if(response[0].success == true){

                featureEditor.addGrid.store.setData({});
                featureEditor.addGrid.refresh();
                featureEditor.ui.handleAddRecord(true);
                featureEditor.ui.handleAddRemoveEditGrid(false);

                featureEditor.queryRecordsByPage(featureEditor.pageInfo.currentPage);
                //featureEditor.grid.save();
                console.log("insertNewFeature successful: " + response);
                featureEditor.loadingIcon.hide();

                if(confirm)alert("Feature #" + response[0].objectId + " was successfully added." );
            }
            else{
                console.log("insertNewFeature: There was a problem with writing the record to database");
                featureEditor.grid.refresh();
                featureEditor.loadingIcon.hide();
                alert("There was a problem and feature was not added.");
            }
        },function(error){
            //NOTE: There is a bug in which the correct error message is not displayed
            //Until it's fixed view the response payload in the Network tab of the developer tools.
            var message = "";
            if(error.code)message = error.code;
            if(error.description)message += error.description;
            console.log("insertNewFeature: " + error.message + ", " + message);

            featureEditor.grid.refresh();
            featureEditor.loadingIcon.hide();

            alert("There was a problem adding a new feature: " + error.message + ", " + message);
        });
    }; // featureEditor.insertNewFeature


    /**
     * Used to DELETE record/feature from a remote feature service.
     * @param data featureEditor.currentRecord
     * @param token String
     * @param confirm use an alert to confirm if delete was successful.
     */
    featureEditor.deleteFeature = function(/* Object */ data, /* String */ token, /* boolean */ confirm) {
        // featureEditor.deleteFeature(featureEditor.currentRecord, null, true);
        console.log("featureEditor.deleteFeature. data, token, confirm: ", data, token, confirm);
        var oid = parseInt(data.OBJECTID, 10);

        // find master record
        var mrec = null;
        console.debug("featureEditor.masterRecordArr: ", featureEditor.masterRecordArr);
        for(var ind in featureEditor.masterRecordArr) {
            var mr = featureEditor.masterRecordArr[ind];
            if(mr.attributes['OBJECTID'] == oid) {
                mrec = mr;
                break;
            }
        }
        if(mrec == null) {
            alert("Unable to find feature. Master record undefined");
            return;
        }

        var graphic = null;
        graphic = new esri.Graphic(
            null,
            null,
            mrec.attributes,
            null
        );

        featureEditor.featureLayer.applyEdits(null, null, [graphic],
            function(adds, updates, deletes) {
                if(deletes[0].success == true) {
                    //featureEditor.queryRecordsByPage(1);
                    //featureEditor.grid.save();
                    console.log("deleteFeatures successful on ObjectID: " + deletes[0].objectId + ", success: " + deletes[0].success);
                    if(confirm) alert("deleteFeatures successful on ObjectID: " + deletes[0].objectId);
                    featureEditor.init(true);
                }
                else{
                    console.log("deleteFeature: There was a problem with writing the record to database");
                    featureEditor.grid.refresh();
                }
                featureEditor.loadingIcon.hide();
            },
            function(error) {
                //NOTE: There is a bug in which the correct error message is not displayed
                //Until it's fixed view the response payload in the Network tab of the developer tools.
                var message = "";
                if(error.code) message = error.code;
                if(error.description) message += error.description;
                console.log("deleteFeature: " + error.message + ", " + message);
                alert("There was a problem deleting record: " + error.message + ", " + message);
                featureEditor.grid.refresh();
                featureEditor.loadingIcon.hide();
            }
        ); // applyEdits
    }; // featureEditor.deleteFeature


// INFO: row action buttons can be done like this: http://jsfiddle.net/knokit/KFkNB/4/
// http://stackoverflow.com/questions/13192846/how-to-revert-single-edited-row-in-dojo-dgrid
// about dirty: https://github.com/SitePen/dgrid/wiki/editor
// http://www.sitepen.com/blog/2011/10/26/introducing-the-next-grid-dgrid/
// http://reuben-in-rl.blogspot.ru/2011/12/baby-steps-with-dojo-datagrid-and.html

    /**
     * Button 'Save' onClick handler
     *   <button dojoType="dijit.form.Button" onclick="featureEditor.saveCurrentRecord();">
     *       Save
     *   </button>
     */
    featureEditor.saveCurrentRecord = function() {
        try {
            var oid = parseInt(featureEditor.currentRecord.OBJECTID);
            console.log("featureEditor.saveCurrentRecord. oid: ", oid);
            featureEditor.updateFeature(featureEditor.currentRecord);
        } catch(ex) {
            alert("Set current record first by single click on any table row");
            console.log("Error in featureEditor.saveCurrentRecord. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
    }; // featureEditor.saveCurrentRecord


    /**
     * Button 'Undo' onClick handler
     *   <button dojoType="dijit.form.Button" onclick="featureEditor.resetCurrentRecord();">
     *       Undo
     *   </button>
     */
    featureEditor.resetCurrentRecord = function() {
        try {
            var oid = parseInt(featureEditor.currentRecord.OBJECTID);
            console.log("featureEditor.resetCurrentRecord. oid: ", oid);
            featureEditor.utils.revertCurrentRecord();
        } catch(ex) {
            alert("Set current record first by single click on any table row");
            console.log("Error in featureEditor.resetCurrentRecord. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
    }; // featureEditor.resetCurrentRecord


    /**
     * Button 'Delete' onClick handler
     *   <button dojoType="dijit.form.Button" onclick="featureEditor.deleteCurrentRecord();">
     *       Delete
     *   </button>
     */
    featureEditor.deleteCurrentRecord = function() {
        try {
            var oid = parseInt(featureEditor.currentRecord.OBJECTID);
            console.log("featureEditor.deleteCurrentRecord. oid: ", oid);
            if(confirm("Are you really want to DELETE current record?"))
                featureEditor.deleteFeature(featureEditor.currentRecord, null, true);
        } catch(ex) {
            alert("Set current record first by single click on any table row");
            console.log("Error in featureEditor.deleteCurrentRecord. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
    }; // featureEditor.deleteCurrentRecord


    /**
     * Validates a url
     * @param url
     * @returns boolean
     */
    featureEditor.utils.validateURL = function(/* String */ url) {
        console.log("featureEditor.utils.validateURL. url:", arguments);
        return  /^(ftp|http|https):\/\/[^ "]+$/.test(url);
    };


    featureEditor.utils.strStartsWith = function(str, prefix, isCI) {
        if(isCI ? isCI : false) {
            str = str.toLowerCase();
            prefix = prefix.toLowerCase();
        }
        return str.indexOf(prefix, 0) === 0;
    }; // featureEditor.utils.strStartsWith


    featureEditor.utils.toJson = function(obj) {
        return dojox.json.ref.toJson(obj);
    }; // featureEditor.utils.toJson


    featureEditor.utils.fromJson = function(str) {
    //    this.log("mpvlib.fromJson: " + str);
        return dojox.json.ref.fromJson(str);
    }; // featureEditor.utils.fromJson


    /**
     * DEPRECATED
     * Button 'Add record' onClick handler. Without graphic.geometry this functionality is preposterous.
     *   <button id="add-new-record-btn" class="recordBtn" disabled="true" dojoType="dijit.form.Button"
     *       onclick="featureEditor.utils.addNewLocalRecord()" >
     *       Add Record
     *   </button>
     * Simply adds a new row to the currently visible grid. Does not automatically push
     * changes to the remote store.
     * Disables the addNewRecord button on the new row has been through a double-click > save
     * cycle.
     */
    featureEditor.utils.addNewLocalRecord = function() {
        console.log("featureEditor.utils.addNewLocalRecord");
        // TODO: debug OBJECTID "TBD" issue

        if(featureEditor.grid == null){
            console.log("addNewLocalRecord: unable to create because primary grid is null.");
            return;
        }

        featureEditor.ui.handleAddRemoveEditGrid(true);
        featureEditor.utils.createAddGrid(featureEditor.columnNamesArr);

        var entryObject = {};

        dojo.forEach(featureEditor.featureLayer.fields, function (entry, i) {

            if(i != 0){
                entryObject[entry.name.toString()] = "edit me";
            }
            else{
                entryObject[entry.name.toString()] = "TBD";
            }

        });

        try{

            featureEditor.addStore.put(entryObject);
            featureEditor.addGrid.refresh();
            //featureEditor.addGrid.row("TBD").element.scrollIntoView();


//                featureEditor.grid.store.put(entryObject);
//                featureEditor.grid.refresh();
//                //featureEditor.grid.row("TBD").element.scrollIntoView();
//
//                var row = featureEditor.grid.row("TBD");
//                dojo.style(row.element,"backgroundColor","#FFFF00");
//                dojo.style(row.element.id,"color","#FF0000 !important");
//                row.element.style.color = "#FF000";

            var row2 = featureEditor.addGrid.row("TBD");
            dojo.style(row2.element,"backgroundColor","#FFFF00");
            //dojo.style(row2.element.id,"color","#FF0000 !important");
            row2.element.style.color = "#FF000";

//                var rowHeight = featureEditor.addGrid.contentNode.children[1].clientHeight;
//                var headerHeight = featureEditor.addGrid.headerNode.clientHeight;
//                dojo.style("add-grid","height",rowHeight + headerHeight + " !important");

//                if(typeof(row.element.children) != "undefined"){
//                    dojo.forEach(row.element.children[0].children,function(entry, i){
//                        entry.style.color = "#FF0000";
//                    })
//                }

            if(typeof(row2.element.children) != "undefined") {
                dojo.forEach(row2.element.children[0].children,function(entry, i){
                    var t = entry.className;
                    if(t.indexOf("dijitButton") == -1){
                        entry.style.color = "#FF0000";
                    }
                });
            }

            featureEditor.ui.handleAddRecord(false);
        }
        catch(err){
            console.log("addNewLocalRecord: " + err.message);
            featureEditor.addGrid.refresh();
            featureEditor.ui.handleAddRecord(false);
        }

    }; // featureEditor.utils.addNewLocalRecord


    /**
     * Reverts a current local record update in the dgrid only.
     * Does not push the change to the server.
     */
    featureEditor.utils.revertCurrentRecord = function() {
        try {
            var oid = parseInt(featureEditor.currentRecord.OBJECTID, 10);
            console.log("featureEditor.utils.revertCurrentRecord, oid: ", oid);
            var dirty = featureEditor.grid.dirty;
            console.debug("grid.dirty: ", featureEditor.utils.toJson(dirty));
            // grid.dirty:  {"1":{"LABEL":"Добавить1"},"2":{"LABEL":"Удалить2"},"3":{"LABEL":"Удалить"}}
            for(var key in dirty) {
                console.debug("dirty key val: ", key, dirty[key]);
                if(key == oid) {
                    delete dirty[key];
                    console.debug("deleted");
                    break;
                }
            }
            featureEditor.grid.refresh();
        } catch(ex) {
            console.log("revertCurrentRecord fail. error: ", ex);
            alert("Undo failed: " + ex.message + "/n" + ex.description);
        }
    }; // featureEditor.utils.revertCurrentRecord


    /**
     * DEPRECATED
     * Reverts a single local record update in the temporary addGrid only.
     * Does not push the change to the server.
     */
    featureEditor.utils.revertLocalAddRecord = function() {
        console.log("featureEditor.utils.revertLocalAddRecord");
        var dirty = featureEditor.addGrid.dirty;
        var id = Object.keys(dirty)[0];
        delete dirty[id];
        featureEditor.addGrid.refresh();
    }; // featureEditor.utils.revertLocalAddRecord


    /**
     * DEPRECATED
     * Button 'Remove new record' onClick handler. Removing 'add new record' functionality we also remove this:
     *   <button id="remove-new-record-btn" class="recordBtn" disabled="true" dojoType="dijit.form.Button"
     *       onclick="featureEditor.utils.removeNewLocalRecord()" >
     *       Remove New Record
     *   </button>
     * Rolls back a newly enter row by deleting it from the grid.store.
     */
    featureEditor.utils.removeNewLocalRecord = function() {
        console.log("featureEditor.utils.removeNewLocalRecord");

//            when(featureEditor.addGrid.store.query(function(){
//                return true;
//            }),function(results){
//                dojo.forEach(results, function (entry, i){
//                    //console.log(entry);
//                    for (var value in entry){
//                        if(entry[value] === "TBD"){
//                            featureEditor.addGrid.store.remove(entry[value]);
//                            featureEditor.addGrid.refresh();
//                            featureEditor.ui.handleAddRecord(true);
//                            return;
//                        }
//                    }
//                });
//
//                featureEditor.ui.handleAddRemoveEditGrid(false);
//            })

        featureEditor.addGrid.store.setData({});
        featureEditor.addGrid.refresh();
        featureEditor.addGrid = null;
        featureEditor.ui.handleAddRecord(true);
        featureEditor.ui.handleAddRemoveEditGrid(false);

        featureEditor.init(true);
    }; // featureEditor.utils.removeNewLocalRecord


    /**
     * An optional grid legend that displays fields and a toggle for show/remove
     * if there are many columns and you only want to work with a few.
     * @param grid
     */
    featureEditor.utils.createGridLegend = function(/* Grid */ grid) {
        console.log("featureEditor.utils.createGridLegend. grid: ", arguments);
        // TODO: checkboxes all checked after data page load
        var htmlString = "";
        dojo.forEach(grid.columns, function(entry, i) {
            if(typeof(entry.label) !== "undefined" ){
                htmlString +=  "<input type='checkbox' onclick='featureEditor.utils.addRemoveColumns(" + i +")' id='checkbox" +
                        i + "' checked='yes' value='"+ i +"'>" + entry.label  + "<br/>";
            };
        });

        dojo.byId("grid-legend").innerHTML = htmlString;
    }; // featureEditor.utils.createGridLegend


    /**
     * DEPRECATED
     * A temporary grid that is created to specifically handle new entries.
     * @param object An object containing the columns for the custom OnDemandGrid
     */
    featureEditor.utils.createAddGrid = function(/* Object */ object) {
        console.log("featureEditor.utils.createAddGrid. object: ", object);

        try{

            var dataIDProperty = object[0].field;   //DEFAULT...Could be problematic depending on browser!
            featureEditor.addStore = new Memory({
                data:[],
                idProperty:dataIDProperty
            });

            var CustomGrid = declare([OnDemandGrid,Selection,CellSelection,Keyboard]);

            // Dojo's dGrid
            featureEditor.addGrid = new CustomGrid({
                store:featureEditor.addStore,
                columns:object,
                selectionMode:'single'/*,
                 noDataMessage:'Nothing found.'*/
            }, 'add-grid');


            featureEditor.utils._setAddGridListeners(false);

        }
        catch(err){
            complete = false;
            console.log("createAddGrid: " + err.message);
        }
    }; // featureEditor.utils.createAddGrid


    /**
     * Create the data grid
     * @param fields Array of dgrid field metadata
     */
    featureEditor.utils._createGrid = function(/* Object */ fields) {
        console.log("featureEditor.utils._createGrid. fields: ", this.toJson(arguments));
        // create grid
        try {
            featureEditor.store = new Memory({
                data:       [],
                idProperty: fields[0].field // OBJECTID probably
            });

            // Dojo's dGrid
            var DataGrid = declare([OnDemandGrid, Selection, CellSelection, Keyboard]);
            featureEditor.grid = new DataGrid({
                store:          featureEditor.store,
                columns:        fields,
                selectionMode:  'single'    /*, noDataMessage:'Nothing found.' */
            }, 'grid');
            featureEditor.grid.startup();

            featureEditor.utils._setListeners();

            featureEditor.utils.createGridLegend(featureEditor.grid);
            dojo.byId("grid-legend-parent").style.visibility = "visible";
            dojo.byId("grid-legend-parent").style.position = "relative";

            featureEditor.featureLayer.isEditable() == true ?
                featureEditor.ui.handleAddRecord(true) :
                featureEditor.ui.handleAddRecord(false);
        } catch(err) {
            console.log("_createGrid error: ", err);
        }
    }; // featureEditor.utils._createGrid


    /**
     * Create grid and update cells
     * featureEditor.utils.updateGrid(featureSet, pageNumber, arr, columnArr);
     * @param arr Array of field names, like ["OBJECTID", "RECID", "LABEL", "DESCR", "NOTE"]
     * @param columnArr Array of dgrid field metadata
     */
    featureEditor.utils.updateGrid = function(featureSet, pageNumber, /* Array */ arr, columnArr) {
        console.log("featureEditor.utils.updateGrid. featureSet, pageNumber, arr, columnArr: ", arguments);
        this._createGrid(columnArr);
        var data = [];
        featureEditor.masterRecordArr = [];

        // copy data to arrays
        dojo.forEach(featureSet.features,
            function (entry, ind) {
                var entryObject = {};
                for (var item in arr) {
                    var attrName = arr[item].toString();
                    var attrVal = entry.attributes[attrName];
                    //~ console.debug("updateGrid. attr. name, val: ", [attrName, attrVal]);
                    if(attrVal === null) {
                        entryObject[attrName] = attrVal;
                    }
                    else{
                        entryObject[attrName] = attrVal.toString();
                    }
                    if(attrName == 'OBJECTID') {
                        //~ entryObject['id'] = parseInt(attrVal);
                    }
                }

                featureEditor.masterRecordArr[ind] = {
                    geometry:       entry.geometry,
                    infoTemplate:   entry.infoTemplate,
                    symbol:         entry.symbol,
                    attributes:     entry.attributes
                };

                data.push(entryObject);
            }
        ); // end copy data

        console.log("featureEditor.utils.updateGrid. finish...");
        try {
            featureEditor.store = new Memory({
                data:       data,
                idProperty: columnArr[0].field // TODO: OBJECTID probably
            });
            featureEditor.grid.set("store", featureEditor.store); // store.setData(data);
            featureEditor.grid.refresh();
        } catch(ex) {
            console.log("Error in featureEditor.utils.updateGrid. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
    }; // featureEditor.utils.updateGrid


    /**
     * Helper function for adding and removing columns for better visibility
     * in FeatureServices that have many fields.
     * @param id
     */
    featureEditor.utils.addRemoveColumns = function(/* number */ id) {
        console.log("featureEditor.utils.addRemoveColumns. id: ", arguments);

        var column = featureEditor.grid.columns[id];

        if(column.hidden == false) {
            featureEditor.grid.styleColumn(id, "display:none;");
            featureEditor.grid.columns[id].hidden = true;
        } else {
            featureEditor.grid.styleColumn(id, "display:table-cell;");
            featureEditor.grid.columns[id].hidden = false;
        }
    }; // featureEditor.utils.addRemoveColumns


    /**
     * For handling edit click events. Be aware of differences between Chrome, Firefox and IE.
     * call example: featureEditor.utils._renderCellHandler(stuff.row, null, stuff.element);
     * @param object - usually the row object
     * @param data
     * @param cell - the cell that was clicked
     * @private
     */
    featureEditor.utils._renderCellHandler = function(object, data, cell) {
        console.log("featureEditor.utils._renderCellHandler. object, data, cell: ", arguments);

        var length = 0;
        var saveBtn = null;
        var saveBtnCell = null;
        var undoBtn = null;
        var undoBtnCell = null;
        var deleteBtn = null;
        var deleteBtnCell = null;

        try {
            if(cell.children.length == 0) { // TODO: I don't want OBJECTID field be yellow forever
                //uneditable feature (OID?)
                cell.style.backgroundColor = "#FFFF00";
                cell.style.color = "#FF0000";
                return;
            }

            if(object.element.hasChildNodes() && typeof(cell.parentNode.cells) == "undefined") {
                var child0 = object.element.children[0];
                //set save button disabled state to false
                length = child0.childNodes.length;

                saveBtn = child0.childNodes[length - 3].children[0].children[0].children[0];
                dijit.byId(saveBtn.id).set('disabled',false);
                saveBtnCell = child0.childNodes[length - 3].children[0].children[0];
                saveBtnCell.style.backgroundColor = "#52D017";

                undoBtn = child0.childNodes[length - 2].children[0].children[0].children[0];
                dijit.byId(undoBtn.id).set('disabled',false);
                undoBtnCell = child0.childNodes[length - 2].children[0].children[0];
                undoBtnCell.style.backgroundColor = "#ffff00";

                deleteBtn = child0.childNodes[length - 1].children[0].children[0].children[0];
                dijit.byId(deleteBtn.id).set('disabled',false);
                deleteBtnCell = child0.childNodes[length - 1].children[0].children[0];
                deleteBtnCell.style.backgroundColor = "#ff0000";
            }
            else{
                //IE 9 hack
                length = cell.parentNode.cells.length;

                saveBtn = cell.parentNode.cells[length - 3].children[0].children[0].children[0];
                dijit.byId(saveBtn.id).set('disabled',false);
                saveBtnCell = cell.parentNode.cells[length - 3].children[0].children[0];
                saveBtnCell.style.backgroundColor = "#52D017";

                undoBtn = cell.parentNode.cells[length - 2].children[0].children[0].children[0];
                dijit.byId(undoBtn.id).set('disabled',false);
                undoBtnCell = cell.parentNode.cells[length - 2].children[0].children[0];
                undoBtnCell.style.backgroundColor = "#ffff00";

                deleteBtn = cell.parentNode.cells[length - 1].children[0].children[0].children[0];
                dijit.byId(deleteBtn.id).set('disabled',false);
                deleteBtnCell = cell.parentNode.cells[length - 1].children[0].children[0];
                deleteBtnCell.style.backgroundColor = "#ff0000";
            }

        } catch(ex) {
            console.log("Error in featureEditor.utils._renderCellHandler. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
    }; // featureEditor.utils._renderCellHandler


    /**
     * DEPRECATED
     * For handling edit click events in the Add New Grid. Be aware of differences between Chrome, Firefox and IE.
     * @param object - usually the row object
     * @param data
     * @param cell - the cell that was clicked
     * @private
     */
    featureEditor.utils._renderAddCellHandler = function(object, data, cell) {
        console.log("featureEditor.utils._renderAddCellHandler. object, data, cell: ", object, data, cell);

        var length = 0;
        var saveBtn = null;
        var saveBtnCell = null;
        var undoBtn = null;
        var undoBtnCell = null;
        var deleteBtn = null;
        //var deleteBtnCell = null;

        if(cell.children.length == 0){
            //uneditable feature
            cell.style.backgroundColor = "#FFFF00";
            cell.style.color = "#FF0000";
            //featureEditor.utils.revertCurrentRecord();
            return;
        }

        if(object.element.hasChildNodes() && typeof(cell.parentNode.cells) == "undefined"){
            var child0 = object.element.children[0];

            //set save button disabled state to false
            length = child0.childNodes.length;
            saveBtn = child0.childNodes[length - 3].children[0].children[0].children[0];
            dijit.byId(saveBtn.id).set('disabled',false);

            saveBtnCell = child0.childNodes[length - 3].children[0].children[0];
            saveBtnCell.style.backgroundColor = "#52D017";

            undoBtn = child0.childNodes[length - 2].children[0].children[0].children[0];
            dijit.byId(undoBtn.id).set('disabled',false);

            undoBtnCell = child0.childNodes[length - 2].children[0].children[0];
            undoBtnCell.style.backgroundColor = "#ffff00";

            //Leave 'disabled' -- use Remove New Record button
            deleteBtn = child0.childNodes[length - 1].children[0].children[0].children[0];
            dijit.byId(deleteBtn.id).set('disabled',true);
//                deleteBtnCell = child0.childNodes[length - 1].children[0].children[0];
//                deleteBtnCell.style.backgroundColor = "#ff0000";
        }
        else{
            //IE 9 hack
            try{
                length = cell.parentNode.cells.length;
                saveBtn = cell.parentNode.cells[length - 3].children[0].children[0].children[0];
                dijit.byId(saveBtn.id).set('disabled',false);

                saveBtnCell = cell.parentNode.cells[length - 3].children[0].children[0];
                saveBtnCell.style.backgroundColor = "#52D017";

                undoBtn = cell.parentNode.cells[length - 2].children[0].children[0].children[0];
                dijit.byId(undoBtn.id).set('disabled',false);

                undoBtnCell = cell.parentNode.cells[length - 2].children[0].children[0];
                undoBtnCell.style.backgroundColor = "#ffff00";

                //Leave 'disabled' -- use Remove New Record button
                deleteBtn = cell.parentNode.cells[length - 1].children[0].children[0].children[0];
                dijit.byId(deleteBtn.id).set('disabled',true);

//                    deleteBtnCell = cell.parentNode.cells[length - 1].children[0].children[0];
//                    deleteBtnCell.style.backgroundColor = "#ff0000";

            }
            catch(err){
                console.log("_renderAddCellHandler: " + err.message);
            }
        }
    }; // featureEditor.utils._renderAddCellHandler


    /**
     * Internal method for setting up listeners.
     * Called from _createGrid
     * @private
     */
    featureEditor.utils._setListeners = function() {
        console.log("featureEditor.utils._setListeners", arguments);

        if(featureEditor.dgridRowClickListener != null) featureEditor.dgridRowClickListener.remove();
        featureEditor.dgridRowClickListener = featureEditor.grid.on(".dgrid-row:click",
            function(event) { // single row click, set currentRecord
                console.log("featureEditor.grid.on.dgrid-row:click event: ", arguments);
                var stuff = featureEditor.grid.row(event);
                console.debug("set featureEditor.currentRecord = stuff.data. stuff: ", stuff);
                featureEditor.currentRecord = stuff.data;
                // row onClick external callback
                if(featureEditor.rowOnClick) featureEditor.rowOnClick.apply(this, arguments);
            }
        );

        if(featureEditor.dgridCellDblClickListener != null) featureEditor.dgridCellDblClickListener.remove();
        featureEditor.dgridCellDblClickListener = featureEditor.grid.on(".dgrid-cell:dblclick",
            function(event) { // double cell click, edit
                console.log("featureEditor.grid.on.dgrid-cell:dblclick. event: ", arguments);
                var stuff = featureEditor.grid.cell(event);
                console.debug("cell: ", stuff);
                if(typeof(stuff.column) !== "undefined") {
                    //~ console.debug("cell html: ", stuff.element.innerHTML);
                    featureEditor.utils._renderCellHandler(stuff.row, null, stuff.element);
                    // cell onDblClick external callback
                    if(featureEditor.cellOnDblClick) featureEditor.cellOnDblClick.apply(this, arguments);
                }
            }
        );
    }; // featureEditor.utils._setListeners


    /**
     * DEPRECATED
     */
    featureEditor.utils._setAddGridListeners = function(/* boolean */ enableRow) {
        console.log("featureEditor.utils._setAddGridListeners. enableRow: ", enableRow);

        featureEditor.dgridAddRowClickListener = featureEditor.addGrid.on(".dgrid-row:click",function(event){
            var stuff = featureEditor.addGrid.row(event);
            console.log(stuff.data);
            featureEditor.currentAddRecord = stuff.data;
            if(enableRow == true)featureEditor.currentAddRow = this;
        });

        featureEditor.dgridAddCellClickListener = featureEditor.addGrid.on(".dgrid-cell:dblclick",function(event){
            var stuff = featureEditor.addGrid.cell(event);

            var undo =  typeof (stuff.column.undo);
            var save =  typeof (stuff.column.save);

            //Check for double clicks on the Save and Undo buttons
            if(typeof(stuff.column) !== "undefined" && ( save == "undefined" && undo == "undefined")){
                console.log(stuff.element.innerHTML);
                featureEditor.utils._renderAddCellHandler(stuff.row,null,stuff.element);
            }
        });
    }; // featureEditor.utils._setAddGridListeners


    /**
     * Creates a waiting icon
     * @param target Id of the element
     * @returns {Node}
     * @private
     */
    featureEditor.utils._createStandbyIcon = function(/* String */ target) {
        console.log("featureEditor.utils._createStandbyIcon. target: ", arguments);
        var standbyIcon = new Standby({target : target, color : "grey"});
        document.body.appendChild(standbyIcon.domNode);
        standbyIcon.startup();
        return standbyIcon;
    }; // featureEditor.utils._createStandbyIcon


    /**
     * Basic date formatter
     * @param value
     * @returns {String}
     */
    featureEditor.utils.formatDate = function(value) {
        console.log("featureEditor.utils.formatDate. value: ", value);

        var inputDate = new Date(value);
        return dojo.date.locale.format(inputDate, {
            selector   :'date',
            datePattern:'MMMM d, y'
        });
    }; // featureEditor.utils.formatDate


    //////////////////////////////////////////////////////
    //   USER INTERFACE CONTROLS
    //   Functions for organizing user interface controls
    //////////////////////////////////////////////////////

    /**
     * DEPRECATED
     * Handles CSS for Add Record and Remove New Record buttons.
     * Default is true in which Add Record Button is active and Remove button is disabled.
     * @param value boolean
     */
    featureEditor.ui.handleAddRecord = function(/* boolean  */ value) {
        console.log("featureEditor.ui.handleAddRecord. value: ", value);
        try {
            if(value == true) {
                dijit.byId("remove-new-record-btn").set("disabled",true);
                dojo.style("remove-new-record-btn","color","#C0C0C0");
                dijit.byId("add-new-record-btn").set("disabled",false);
                dojo.style("add-new-record-btn","color","#FF0000");
            } else {
                dojo.byId("entryEditableField").innerHTML = "NOT EDITABLE";
                dijit.byId("remove-new-record-btn").set("disabled",true);
                dojo.style("remove-new-record-btn","color","#C0C0C0");
                dijit.byId("add-new-record-btn").set("disabled",true);
                dojo.style("add-new-record-btn","color","#C0C0C0");
            }
        }
        catch(ex) {
            console.log("Error in featureEditor.ui.handleAddRecord. \n" +
                'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }
    }; // featureEditor.ui.handleAddRecord


    /**
     * DEPRECATED
     * Handles adding or removing the EditGrid. True equals visible.
     * @param value boolean
     */
    featureEditor.ui.handleAddRemoveEditGrid = function(/* boolean */ value) {
        console.log("featureEditor.ui.handleAddRemoveEditGrid. value: ", value);
        try {
            if(value == true) {
                dojo.style("add-grid","visibility","visible");
                dojo.style("add-grid","display","block");
            } else {
                dojo.style("add-grid","visibility","hidden");
                dojo.style("add-grid","display","none");
            }
        } catch(ex) {
            console.log("Error in featureEditor.ui.handleAddRemoveEditGrid. \n" + 'message: ' + ex.description + "\n" + ex.message, ex);
            console.debug('error stack: ' + ex.stack);
            window.lastex = ex;
        }

    }; // featureEditor.ui.handleAddRemoveEditGrid

}); // dojo.require
