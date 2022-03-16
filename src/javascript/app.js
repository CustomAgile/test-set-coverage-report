Ext.define("CArABU.app.TSApp", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new CArABU.technicalservices.Logger(),

    items: [
        { xtype:'container',itemId:'selector_box', layout:{type:'hbox'}}, //top, right, bottom, left
        {xtype:'container',itemId:'top_box',layout:{type:'vbox'},items: [
            {xtype:'container',itemId:'totals_f_box', layout:{type:'hbox'}, margin: 5},
            {xtype:'container',itemId:'totals_box',layout:{type:'hbox'}, margin: 5}
            ]},
        {xtype:'container',itemId:'display_box'}
    ],

    integrationHeaders : {
        name : "CArABU.app.TSApp"
    },
    config: {
        defaultSettings: {
            gridWidth: 1200
        }
    },
    modelNames : ['TestSet'],
    launch: function() {
        var me = this;
        this.logger.setSaveForLater(this.getSetting('saveLog'));

        me._addSelector();
        setTimeout(function(){ me.updateView(); }, 500);
        
    },

    _addSelector: function(){
        var me = this;
       
        me.down('#selector_box').add([
            {
                xtype: 'rallyreleasecombobox',
                name: 'releaseCombo',
                itemId: 'releaseCombo',
                stateful: true,
                stateId: 'releaseCombo-test-set',   
                fieldLabel: 'Select Release:',
                multiSelect: true,
                margin: '10 10 10 10', 
                width: 450,
                labelWidth: 100,
                cls: 'rally-checkbox-combobox',
                valueField:'Name',
                showArrows: false,
                displayField: 'Name'
                ,
                listConfig: {
                    cls: 'rally-checkbox-boundlist',
                    itemTpl: Ext.create('Ext.XTemplate',
                        '<div class="rally-checkbox-image"></div>',
                        '{[this.getDisplay(values)]}</div>',
                        {
                            getDisplay: function(values){
                                return values.Name;
                            }
                        }
                    )
                }
            },
            {
                xtype:'rallybutton',
                name: 'updateButton',
                itemId: 'updateButton',
                margin: '10 10 10 10',
                text: 'Update',
                listeners: {
                    click: me.updateView,
                    scope: me
                }
            }
        ]);
    },

    _clearGrids: function(){
        this.down('#display_box').removeAll();
        this.down('#totals_f_box').removeAll();
        this.down('#totals_box').removeAll();
    },

    updateView: function(){
        var me = this;


        if(!me.down('#releaseCombo')) return;
        var cb = me.down('#releaseCombo');
        if(cb.valueModels.length == 0){
            Rally.ui.notify.Notifier.showError({ message: "Please select one or more releases to display the report" });
            return;
        }

        me._clearGrids();
        
        var r_filters = [];
        Ext.Array.each(me.down('#releaseCombo').value, function(rel){
            r_filters.push({
                property: 'Release.Name',
                value: rel
            })
        });

        r_filters = Rally.data.wsapi.Filter.or(r_filters)

        var ts_object_ids = [];


        me.setLoading(true);
        me._getSelectedPIs(me.modelNames[0],r_filters).then({
            success: function(records){
                if(records.length == 0){
                    me.showErrorNotification('No Data found!');
                    me.setLoading(false);
                }

                var promises = [];


                Ext.Array.each(records,function(r){
                    ts_object_ids.push(r.get('ObjectID'));
                    promises.push(me._getTestCaseCollection(r));
                });


                Deft.Promise.all(promises).then({
                    success: function(records){

                        records = Ext.Array.flatten(records);
                        
                        console.log('collections',records);

                        me.test_sets = {};
                        me.test_cases = {};

                        Ext.Array.each(records, function(rec){
                            me.test_sets[rec.TestSet] = {'TestCases': {}}
                            Ext.Array.each(rec.TestCases, function(tc){

                                me.test_sets[rec.TestSet]['TestCases'][tc.get('ObjectID')] = {
                                    'ObjectID': tc.get('ObjectID'),
                                    'FormattedID': tc.get('FormattedID'),
                                    'Name': tc.get('Name'),
                                    'Method': tc.get('Method'),
                                    'Verdict' : null
                                }
                            });
                        });

                        console.log(' me.test_sets', me.test_sets);

                        me._getTCRs(ts_object_ids).then({
                            success: function(records){
                                Ext.Array.each(records,function(tcr){
                                    me.test_sets[tcr.get('TestSet').ObjectID].TestCases[tcr.get('TestCase').ObjectID].Verdict = tcr.get('Verdict');
                                });

                                Ext.create('Rally.data.wsapi.TreeStoreBuilder').build({
                                    models: me.modelNames,
                                    enableHierarchy: true
                                }).then({
                                    success: me._addGrid,
                                    scope: me
                                });

                            },
                            scope: me
                        });
                       
                    },
                    scope: me
                })

            },
            failure: function(message){
                me.showErrorNotification('Error. Check console logs');
                console.log('Error:',message);
                me.setLoading(false);
            },
            scope: me         
        });
    },


    _getTestCaseCollection: function(ts){
        var deferred = Ext.create('Deft.Deferred');
            var results = {'TestSet': ts.get('ObjectID'), 'TestCases' : []};
            ts.getCollection('TestCases').load({
                fetch: ['FormattedID', 'Name', 'LastVerdict','ObjectID','Method'],
                limit: 2000,
                pageSize: 2000,
                callback: function(records, operation, success) {
                    Ext.Array.each(records, function(tc) {
                        if(results.TestSet){
                            results.TestCases.push(tc);
                        }else{
                            results['TestCases'] = [tc];
                        }
                    });
                    deferred.resolve(results);                    
                }
            });
        return deferred.promise;
    },

    _getSelectedPIs: function(selectedPI,filters){
        var me = this;
        var config = {
                        model : selectedPI,
                        fetch : ['ObjectID','FormattedID','TestCases'],
                        limit:'Infinity'
                    }
        if(filters){
            config['filters'] = filters;
        }
        return me._loadWsapiRecords(config);
    },

    _getTCRs: function(filters){
        console.log('_getTCRs filters', filters);
        var deferred = Ext.create('Deft.Deferred');
        var me = this;

        Ext.create('CArABU.technicalservices.chunk.Store',{
            storeConfig: {
                model: 'TestCaseResult',
                fetch: ['ObjectID','Verdict','TestSet','TestCase','Name','FormattedID','Method','Build','LastBuild','Date','LastRun'],
                sorters: [
                    {
                        property: 'Date',
                        direction: 'ASC'
                    }
                ]                
            },
            chunkProperty: 'TestSet.ObjectID',
            chunkValue: filters
        }).load().then({
            success: function(records){
                deferred.resolve(records);
            },
            failure: me.showErrorNotification,
            scope: me
        });

        return deferred.promise;
    },

    _addGrid: function (store) {

        var me = this;
        var context = me.getContext();
        store.on('load', me._updateAssociatedData, me);
        var r_filters = [];
        Ext.Array.each(me.down('#releaseCombo').value, function(rel){
            r_filters.push({
                property: 'Release.Name',
                value: rel
            })
        });

        r_filters = Rally.data.wsapi.Filter.or(r_filters)

        console.log('Filter>>', r_filters && r_filters.toString());
        me.down('#display_box').removeAll();
        me.down('#display_box').add({
                  itemId: 'pigridboard',
                  xtype: 'rallygridboard',
                  context: context,
                  modelNames: me.modelNames,
                  // autoScroll: true,
                  toggleState: 'grid',
                  // layout:'fit',
                  //padding: 5,
                  border: 1,
                  style: {
                      borderColor: 'lightblue',
                      borderStyle: 'solid'
                  },
                  plugins: me._getPlugins(),
                  gridConfig: {
                    store: store,
                    enableEditing: false,
                    storeConfig:{
                        filters: r_filters
                    },
                    stateful: true,
                    stateId: context.getScopedStateId('gridboard_state'),                                         
                    columnCfgs: me._getColumnCfgs(),
                    derivedColumnCfgs: me.getDerivedColumns(),
                    shouldShowRowActionsColumn:false,
                    enableRanking: false,
                    enableBulkEdit: false,
                    sortableColumns: true,
                    // autoScroll: true,
                    // scroll : 'both',
                    viewConfig: {
                        xtype: 'rallytreeview',
                        enableTextSelection: false,
                        animate: false,
                        loadMask: false,

                        listeners: {
                            cellclick: me.showDrillDown,
                            scope: me
                        }
                    }     
                  },
                  listeners: {
                     load: me._addTotals,
                    viewChange: me.updateView,
                    scope: me
                  }
                  ,         
                  height: 500
                  ,
                  width:me.getSetting('gridWidth')
              });

        me.setLoading(false);
    },


   _addTotals:function(grid) {
        var me = this;
        var filters = grid && grid.gridConfig.store.filters.items;
        var allPi;
        me.setLoading('Loading totals...');
            me._getSelectedPIs(me.modelNames[0],filters).then({
                success: function(records){

                    var totalPass = {value:0,records:[]},
                        totalFail = {value:0,records:[]},
                        totalNoRun = {value:0,records:[]},
                        totalOther = {value:0,records:[]},
                        grandTotal = {value:0,records:[]},
                        totalAutomated = 0,
                        pctAutomated = 0,
                        test_set_totals = {};
                    var record = {};
                    Ext.Array.each(records,function(r){
                        test_set_totals[r.get('FormattedID')] = {
                            grandTotal:0,
                            totalPass:0,
                            totalFail:0,
                            totalNoRun:0,
                            totalOther:0,
                            totalAutomated:0                                     
                        }

                        _.each(me.test_sets[r.get('ObjectID')].TestCases, function(tc,key){

                            grandTotal.value++;
                            grandTotal.records.push(record);                                
                            if(test_set_totals[r.get('FormattedID')]){
                                test_set_totals[r.get('FormattedID')].grandTotal++
                            }else{
                                test_set_totals[r.get('FormattedID')] = {
                                    grandTotal:1,
                                    totalPass:0,
                                    totalFail:0,
                                    totalNoRun:0,
                                    totalOther:0,
                                    totalAutomated:0                                       
                                }
                            }
                            if(tc.Method == "Automated"){
                                totalAutomated++;
                                test_set_totals[r.get('FormattedID')].totalAutomated++;
                            }                    
                            if(tc.Verdict == "Pass"){
                                totalPass.value++;
                                totalPass.records.push(tc);
                                test_set_totals[r.get('FormattedID')].totalPass++;
                            }else if(tc.Verdict == "Fail"){
                                totalFail.value++;
                                totalFail.records.push(tc);                                    
                                test_set_totals[r.get('FormattedID')].totalFail++
                            }else if(tc.Verdict == null || tc.Verdict == ""){
                                totalNoRun.value++;
                                totalNoRun.records.push(tc);                                        
                                test_set_totals[r.get('FormattedID')].totalNoRun++;
                            }else{
                                totalOther.value++;
                                totalOther.records.push(tc);                                       
                                test_set_totals[r.get('FormattedID')].totalOther++;
                            }

                        });
                    });

                    if(grandTotal.value > 0){
                        pctAutomated = Ext.Number.toFixed((totalAutomated / grandTotal.value) * 100,2);
                    }

                    var testSetPassing = 0,
                        testSetFailing = 0,
                        testSetNoRun = 0,
                        testSetNotCovered = 0;
                    me.passingTestSetFilters = [];

                    _.each(test_set_totals, function(value, key){
                        //console.log('Key, Value', key,value);
                        if(value.grandTotal === value.totalPass && value.grandTotal > 0) {
                            testSetPassing++;
                            me.passingTestSetFilters.push({property:'FormattedID',operator: '!=',value:key});
                        }
                        if(value.totalFail > 0) testSetFailing++;
                        //The testSet has  test cases, and at least one test has not run and zero test cases have failed.
                        // When a testSet has at least one count in the 'Other' category (inconclusive or blocked) and no failures it is considered Incomplete.
                        if(value.grandTotal > 0 && value.totalFail === 0  && (value.totalNoRun > 0 || value.totalOther > 0)) testSetNoRun++;
                        if(value.totalFail === 0 && value.totalPass === 0 && value.totalNoRun === 0 && value.totalOther === 0) testSetNotCovered++;
                    });

                    console.log('passingtestSetFilters>>',me.passingTestSetFilters);

                    me.down('#totals_f_box').removeAll();
                    me.down('#totals_box').removeAll();
                    //me.down('#filter_box').removeAll();

                    Ext.create('Ext.data.Store', {
                        storeId:'totalStore',
                        fields:['GrandTotal','PctAutomated','TotalPass','TotalFail','TotalNoRun', 'TotalOther'],
                        data:{'items':[
                            { 'GrandTotal': grandTotal, 'PctAutomated': pctAutomated,'TotalPass': totalPass, 'TotalFail': totalFail, 'TotalNoRun': totalNoRun, 'TotalOther': totalOther},
                        ]},
                        proxy: {
                            type: 'memory',
                            reader: {
                                type: 'json',
                                root: 'items'
                            }
                        }
                    });

                    me.down('#totals_box').add({
                        xtype: 'grid',
                        title: 'Test Case Coverage',
                        header:{
                            style: {
                                background: 'lightBlue',
                                'color': 'white',
                                'font-weight': 'bold'
                            }
                        },
                        sortableColumns:false,
                        enableColumnHide:false,
                        store: Ext.data.StoreManager.lookup('totalStore'),
                        columns: [
                            { text: 'Total',  dataIndex: 'GrandTotal',flex:1,
                                renderer: function(GrandTotal){
                                    return GrandTotal.value > 0 ? '<a href="#">' + GrandTotal.value + '</a>' : 0;
                                }
                            },
                            { text: '% Automated', dataIndex: 'PctAutomated', flex:1,
                                renderer: function(value){
                                    return value + ' %'
                                }
                            },
                            { text: 'Passing', dataIndex: 'TotalPass',flex:1,
                                renderer: function(TotalPass){
                                    return TotalPass.value > 0 ? '<a href="#">' + TotalPass.value + '</a>' : 0;
                                }
                            },
                            { text: 'Failing', dataIndex: 'TotalFail',flex:1,
                                renderer: function(TotalFail){
                                    return TotalFail.value > 0 ? '<a href="#">' + TotalFail.value + '</a>' : 0;
                                }
                            },
                            { text: 'No Run', dataIndex: 'TotalNoRun',flex:1,
                                renderer: function(TotalNoRun){
                                    return TotalNoRun.value > 0 ? '<a href="#">' + TotalNoRun.value + '</a>' : 0;
                                }
                            },
                            { text: 'Other', dataIndex: 'TotalOther',flex:1,
                                renderer: function(TotalOther){
                                    return TotalOther.value > 0 ? '<a href="#">' + TotalOther.value + '</a>' : 0;
                                }
                            }
                        ],
                        width:600,
                        viewConfig: {
                            listeners: {
                                cellclick: this.showDrillDown,
                                scope: me
                            }
                        }     
                    });


                    Ext.create('Ext.data.Store', {
                        storeId:'totalTestSetStore',
                        fields:['GrandTotal', 'TestSetPassing','TestSetFailing','TestSetNoRun', 'TestSetNotCovered'],
                        data:{'items':[
                            { 'GrandTotal': records.length, 'TestSetPassing': testSetPassing, 'TestSetFailing': testSetFailing, 'TestSetNoRun': testSetNoRun, 'TestSetNotCovered': testSetNotCovered},
                        ]},
                        proxy: {
                            type: 'memory',
                            reader: {
                                type: 'json',
                                root: 'items'
                            }
                        }
                    });

                    me.down('#totals_f_box').add({
                        xtype: 'grid',
                        title: 'Test Set Coverage',
                        header:{
                            style: {
                                background: 'lightBlue',
                                'color': 'white',
                                'font-weight': 'bold'
                            }
                        },
                        sortableColumns:false,
                        enableColumnHide:false,
                        store: Ext.data.StoreManager.lookup('totalTestSetStore'),
                        columns: [
                            { text: 'Total Test Sets',  dataIndex: 'GrandTotal',flex:1},
                            { text: 'Passing Test Sets', dataIndex: 'TestSetPassing',flex:1},
                            { text: 'Failing Test Sets', dataIndex: 'TestSetFailing',flex:1},
                            { text: 'Incomplete <br>Test Sets', dataIndex: 'TestSetNoRun',flex:1},
                            { text: 'Not Covered <br>Test Sets', dataIndex: 'TestSetNotCovered',flex:1}
                        ],
                        width:500
                    });

                    me.down('#totals_f_box').add({
                        margin: 5,
                        xtype:'rallybutton',
                        text: 'Hide Passing <br>Test Sets',
                        listeners: {
                            click: function(btn){
                                me._hidePassingTestSets();
                            }
                        },
                        scope:me
                    })

                    me.setLoading(false);
                },
                scope:me
            });

 
    },

    _hidePassingTestSets: function(){
        var me = this;
        var filter = Rally.data.wsapi.Filter.and(me.passingTestSetFilters);
                   
        console.log(me.down('#pigridboard'),me.passingTestSetFilters);
        var grid = me.down('#pigridboard')
        var filters = grid && grid.gridConfig.store.filters.items;
        filters.push(filter);
            grid.applyCustomFilter(Ext.apply({
                recordMetrics: true,
                types: me.modelNames,
                filters: _.compact(filters)                
            }));
    },

    _updateAssociatedData: function(store, node, records, success){
        console.log('_updateAssociatedData',records);
        var me = this;
        me.setLoading(true);

        me.suspendLayouts();
        var record = {};
     

        Ext.Array.each(records,function(r){
            var totalPass = {value:0,records:[]},
                totalFail = {value:0,records:[]},
                totalNoRun = {value:0,records:[]},
                totalOther = {value:0,records:[]};
            if(r.get('_type') == 'task'){
                r.parentNode.removeChild(r);
            }else if(r.get('_type') == 'testset'){

                    _.each(me.test_sets[r.get('ObjectID')].TestCases, function(tc,key){

                        if(tc.Verdict == "Pass"){
                            totalPass.records.push(tc);
                            totalPass.value++;
                        }else if(tc.Verdict == "Fail"){
                            totalFail.records.push(tc);
                            totalFail.value++;
                        }else if(tc.Verdict == null || tc.Verdict == ""){
                            totalNoRun.records.push(tc);
                            totalNoRun.value++;
                        }else{
                            totalOther.records.push(tc);
                            totalOther.value++;                        
                        }

                    });
                    r.set('Passing', totalPass);
                    r.set('Failing', totalFail);
                    r.set('NoRun', totalNoRun);
                    r.set('Other', totalOther);   
            }else if(r.get('_type') == 'testcase'){

                var tc = me.test_sets[r.parentNode.get('ObjectID')].TestCases && me.test_sets[r.parentNode.get('ObjectID')].TestCases[r.get('ObjectID')] || null;
                if(tc){
                    if(tc.Verdict == "Pass"){
                        totalPass.records.push(tc);
                        totalPass.value++;
                    }else if(tc.Verdict == "Fail"){
                        totalFail.records.push(tc);
                        totalFail.value++;
                    }else if(tc.Verdict == null || tc.Verdict == ""){
                        totalNoRun.records.push(tc);
                        totalNoRun.value++;
                    }else{
                        totalOther.records.push(tc);
                        totalOther.value++;                        
                    }                    
                }
                r.set('Passing', totalPass);
                r.set('Failing', totalFail);
                r.set('NoRun', totalNoRun);
                r.set('Other', totalOther);                   
            }

  

        });
        me.resumeLayouts();
        me.setLoading(false);

    },

    _getPlugins: function(){
        var me = this;

        var model_names = ['TestSet','TestCase']

        var plugins = [
            {
                ptype: 'rallygridboardinlinefiltercontrol',
                inlineFilterButtonConfig: {
                    stateful: true,
                    stateId: me.getContext().getScopedStateId('filters'),
                    modelNames: model_names,
                    inlineFilterPanelConfig: {
                        collapsed: false,
                        quickFilterPanelConfig: {
                            defaultFields: ['ArtifactSearch', 'Owner'],
                            addQuickFilterConfig: {
                                whiteListFields: ['Milestones', 'Tags']
                            }
                        },
                        advancedFilterPanelConfig: {
                            advancedFilterRowsConfig: {
                                propertyFieldConfig: {
                                    whiteListFields: ['Milestones', 'Tags']
                                }
                            }
                        }  
                    }                  
            },
        }
        ];

        plugins.push({
            ptype: 'rallygridboardfieldpicker',
            headerPosition: 'left',
            modelNames: model_names,
            stateful: true,
            gridAlwaysSelectedValues: ['Name'],
            stateId: me.getContext().getScopedStateId('field-picker')
        });

        plugins.push({
                    ptype: 'rallygridboardsharedviewcontrol',
                    stateful: true,
                    stateId: me.getContext().getScopedStateId('test-set-view'),
                    stateEvents: ['select','beforedestroy'],
                    margin: 5
                });

        return plugins;        
    },


    _getColumnCfgs: function(){
        var me = this;

        return  [{
            dataIndex: 'Name',
            text: 'Name',
            flex: 1
        }].concat(me.getDerivedColumns());
    },


    getDerivedColumns: function(){
        var me = this;
        return [
        {
            tpl: '<div style="text-align:center;"></div>',
            text: 'Result Graph',
            xtype: 'templatecolumn',
            //flex:1,
            renderer: function(value, metaData, record){
                var values = {'lightgreen':record.get('Passing').value,'red':record.get('Failing').value,'yellow':record.get('NoRun').value,'blue':record.get('Other').value}

                if (values && Ext.isObject(values)){
                    var tpl = Ext.create('CArABU.technicalservices.ResultGraphTemplate');
                    return tpl.apply(values);
                }

                return '';
            }
        },
        {
            tpl: '<div style="text-align:center;">{Passing}</div>',
            text: 'Passing',
            //flex:1,
            xtype: 'templatecolumn',
            renderer: function(m,v,r){
                return me.renderLink(r,'Passing');
            }
        },{
            tpl: '<div style="text-align:center;">{Failing}</div>',
            text: 'Failing',
            //flex:1,
            xtype: 'templatecolumn',
            renderer: function(m,v,r){
                return me.renderLink(r,'Failing');
            }
        },{
            tpl: '<div style="text-align:center;">{NoRun}</div>',
            text: 'NoRun',
            //flex:1,
            xtype: 'templatecolumn',
            renderer: function(m,v,r){
                return me.renderLink(r,'NoRun');
            }
        },{
            tpl: '<div style="text-align:center;">{Other}</div>',
            text: 'Other',
            //flex:1,
            xtype: 'templatecolumn',
            renderer: function(m,v,r){
                return me.renderLink(r,'Other');
            }
        }
        ];
    },    
 
    renderLink: function(r,index){
        var value = r.get(index).value == undefined ? '--' : r.get(index).value
        return value > 0 ? '<div style="text-align:center;"><a href="#">' + value + '</a></div>' : '<div style="text-align:center;">'+value+'</a></div>';
    },

    showDrillDown: function(view, cell, cellIndex, record) {
        //console.log('view, cell, cellIndex, record',view, cell, cellIndex, record,view.panel.headerCt.getHeaderAtIndex(cellIndex).dataIndex);
        var me = this;
        var clickedDataIndex = view.panel.headerCt.getHeaderAtIndex(cellIndex).dataIndex || view.panel.headerCt.getHeaderAtIndex(cellIndex).text;
        var allowedIndices = ['Passing','Failing','NoRun','Other','Total','GrandTotal','TotalPass','TotalFail','TotalOther','TotalNoRun']
        if(!Ext.Array.contains(allowedIndices, clickedDataIndex)) return;

        var records = record.get(clickedDataIndex).records;
        // if(ruleValue.constructor != Array) return;

        var store = Ext.create('Rally.data.custom.Store', {
            data: records,
            pageSize: 2000
        });
        
        var title = 'Records for ' + clickedDataIndex || ""

        
        Ext.create('Rally.ui.dialog.Dialog', {
            itemId    : 'detailPopup',
            title     : title,
            width     : Ext.getBody().getWidth()*0.4,
            height    : Ext.getBody().getHeight()*0.4,
            closable  : true,
            layout    : 'border',
            items     : [
                        {
                            xtype                : 'rallygrid',
                            itemId               : 'popupGrid',
                            region               : 'center',
                            layout               : 'fit',
                            sortableColumns      : true,
                            showRowActionsColumn : false,
                            showPagingToolbar    : false,
                            columnCfgs           : this.getDrillDownColumns(title),
                            store : store
                        }
                        ]
        }).show();
    },

    getDrillDownColumns: function(title) {
        var me = this;
        return [
            {
                dataIndex : 'FormattedID',
                text: "id",
                renderer: function(m,v,r){
                    var baseUrl = window.location.protocol + '//' + window.location.host + '/#/detail/testcase/' + r.get('ObjectID');
                    //console.log(baseUrl);
                    return '<a href="' + baseUrl +  '" target="_top" >' + r.get('FormattedID') + '</a>';
                }
            },
            {
                dataIndex : 'Name',
                text: "Name",
                flex: 1
            },
            {
                dataIndex : 'Method',
                text: "Method",
                flex: 1
            },
            {
                dataIndex : 'Verdict',
                text: "Verdict",
                flex: 1
            }
        ];
    },
    _loadWsapiRecords: function(config){
        console.log('_loadWsapiRecords',config);
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID']
        };
        // this.logger.log("Starting load:",config.model);
        Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },

    getSettingsFields: function() {
        var check_box_margins = '5 0 5 0';
        return [        
        {
            xtype: 'rallynumberfield',
            name: 'gridWidth',
            margin: check_box_margins,
            fieldLabel: 'Grid width (in pixels)',
            fieldWidth: 100,
            width: 200
        },{
            name: 'saveLog',
            xtype: 'rallycheckboxfield',
            boxLabelAlign: 'after',
            fieldLabel: '',
            margin: check_box_margins,
            boxLabel: 'Save Logging<br/><span style="color:#999999;"><i>Save last 100 lines of log for debugging.</i></span>'

        }];
    },

    getOptions: function() {
        var options = [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];

        return options;
    },

    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }

        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{
            showLog: this.getSetting('saveLog'),
            logger: this.logger
        });
    },

    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },

    showErrorNotification: function(msg){
        this.logger.log('showErrorNotification', msg);
        Rally.ui.notify.Notifier.showError({
            message: msg
        });
    },    
});