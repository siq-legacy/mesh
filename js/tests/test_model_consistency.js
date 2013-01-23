/*global test, asyncTest, ok, equal, deepEqual, start, module, strictEqual */

// this file exists because it's easier to mock up the Example resource for the
// entire file, and the original test_model.js was using some weird techniques
// to mock the ajax requests
define([
    'vendor/jquery',
    'vendor/underscore',
    './mockedexample',
    './mockednestedpolymorphicexample'
], function($, _, Example, NestedPolymorphicExample) {
    var setup = function(options) {
        var c, dfd = $.Deferred(),
            Resource = options && options.resource? options.resource : Example;

        // clear all of the current models
        Example.models.clear();
        NestedPolymorphicExample.models.clear();
        // reset the example mocking settings to defaults
        Example.mockDelay().mockFailure().mockDataChange();
        NestedPolymorphicExample.mockDelay().mockFailure().mockDataChange();

        if (options && options.noCollection) {
            dfd.resolve();
        } else {
            c = Resource.collection();

            c.load().then(function() {
                dfd.resolve(c);
            }, function(e) {
                console.log('died loading collection:',e);
                ok(false, 'died loading colleciton');
                throw e;
            });
        }

        return dfd;
    };

    module('refresh');

    asyncTest('conditional refresh returns same deferred', function() {
        setup().then(function(c) {
            var dfd1 = c.first().refresh(), dfd2;
            Example.mockDelay(50);
            dfd2 = c.first().refresh(null, {conditional: true});
            ok(dfd1 === dfd2);
            dfd1.then(function() {
                equal(dfd1.state(), 'resolved');
                equal(dfd2.state(), 'resolved');
                start();
            });
        });
    });

    asyncTest('refresh doesnt overwrite changed properties', function() {
        setup().then(function(c) {
            var origValue = c.first().get('text_field'),
                newValue = 'foo';
            ok(c.first().get('text_field') !== newValue);
            c.first().set('text_field', newValue);
            c.first().refresh().then(function() {
                equal(c.first().get('text_field'), newValue);
                start();
            });
        });
    });

    asyncTest('refresh doesnt overwrite properties changed after initial request', function() {
        setup().then(function(c) {
            var dfd, origValue = c.first().get('text_field'),
                newValue = 'foo';
            ok(c.first().get('text_field') !== newValue);
            dfd = c.first().refresh();
            c.first().set('text_field', newValue);
            dfd.then(function() {
                equal(c.first().get('text_field'), newValue);
                start();
            });
        });
    });

    asyncTest('out of order response to refresh with data change', function() {
        setup().then(function(c) {
            Example.mockDelay(100);
            var dfd1 = c.first().refresh(), dfd2;
            Example.mockDataChange(function(exampleFixtures) {
                var cur = _.find(exampleFixtures, function(f) {
                    return f.id === c.first().get('id');
                });
                cur.required_field = 'changed value';
            });
            Example.mockDelay(25);
            dfd2 = c.first().refresh();
            ok(dfd1 !== dfd2, 'deferreds are different');

            dfd1.then(function() {
                equal(dfd2.state(), 'pending',
                    'the second request completed after the first');
                equal(c.first().get('required_field'), 'changed value');
            });

            dfd2.then(function() {
                equal(dfd1.state(), 'resolved',
                    'the first request completed before the second');
                equal(c.first().get('required_field'), 'changed value');
                start();
            });
        });
    });

    asyncTest('out of order response to refresh with data change lifecycle', function() {
        setup().then(function(c) {
            Example.mockDelay(100);
            var dfd1 = c.first().refresh(), dfd2;
            Example.mockDataChange(function(exampleFixtures) {
                var cur = _.find(exampleFixtures, function(f) {
                    return f.id === c.first().get('id');
                });
                cur.required_field = 'changed value';
            });
            Example.mockDelay(25);
            dfd2 = c.first().refresh();
            ok(dfd1 !== dfd2, 'deferreds are different');

            dfd1.then(function() {
                equal(dfd2.state(), 'pending',
                    'the first request completed before the second');
                equal(c.first().get('required_field'), 'changed value');
            });

            dfd2.then(function() {
                equal(dfd1.state(), 'resolved',
                    'the second request completed after the first');
                equal(c.first().get('required_field'), 'changed value');

                Example.mockDelay(100);
                var dfd3 = c.first().refresh(), dfd4;
                Example.mockDataChange(function(exampleFixtures) {
                    var cur = _.find(exampleFixtures, function(f) {
                        return f.id === c.first().get('id');
                    });
                    cur.required_field = 'changed value 2';
                });
                Example.mockDelay(25);
                dfd4 = c.first().refresh();
                ok(dfd3 !== dfd4, 'deferreds are different');

                dfd3.then(function() {
                    equal(dfd4.state(), 'pending',
                        'the third request completed after the second');
                    equal(c.first().get('required_field'), 'changed value 2');
                });

                dfd4.then(function() {
                    equal(dfd3.state(), 'resolved',
                        'the fourth request completed after the third');
                    equal(c.first().get('required_field'), 'changed value 2');

                    equal(c.first()._inFlight.refresh.length, 1,
                        'state was cleaned up property');
                    start();
                });
            });
        });
    });

    asyncTest('in order response to refresh with data change', function() {
        setup().then(function(c) {
            Example.mockDelay(25);
            var dfd1 = c.first().refresh(), dfd2;
            Example.mockDataChange(function(exampleFixtures) {
                var cur = _.find(exampleFixtures, function(f) {
                    return f.id === c.first().get('id');
                });
                cur.required_field = 'changed value';
            });
            Example.mockDelay(50);
            dfd2 = c.first().refresh();
            ok(dfd1 !== dfd2, 'deferreds are different');

            dfd1.then(function() {
                equal(dfd2.state(), 'pending',
                    'the second request completed after the first');
                ok(c.first().get('required_field') == null, 'required field is null');
            });

            dfd2.then(function() {
                equal(dfd1.state(), 'resolved',
                    'the first request completed before the second');
                equal(c.first().get('required_field'), 'changed value');
                start();
            });
        });

    });

    asyncTest('in order response to refresh with data change lifecycle', function() {
        setup().then(function(c) {
            Example.mockDelay(25);
            var dfd1 = c.first().refresh(), dfd2;
            Example.mockDataChange(function(exampleFixtures) {
                var cur = _.find(exampleFixtures, function(f) {
                    return f.id === c.first().get('id');
                });
                cur.required_field = 'changed value';
            });
            Example.mockDelay(50);
            dfd2 = c.first().refresh();
            ok(dfd1 !== dfd2, 'deferreds are different');

            dfd1.then(function() {
                equal(dfd2.state(), 'pending',
                    'the second request completed after the first');
                ok(c.first().get('required_field') == null, 'required field is null');
            });

            dfd2.then(function() {
                equal(dfd1.state(), 'resolved',
                    'the first request completed before the second');
                equal(c.first().get('required_field'), 'changed value');
                Example.mockDelay(25);
                var dfd3 = c.first().refresh(), dfd4;
                Example.mockDataChange(function(exampleFixtures) {
                    var cur = _.find(exampleFixtures, function(f) {
                        return f.id === c.first().get('id');
                    });
                    cur.required_field = 'changed value 2';
                });
                Example.mockDelay(50);
                dfd4 = c.first().refresh();
                ok(dfd3 !== dfd4, 'deferreds are different');

                dfd3.then(function() {
                    equal(dfd4.state(), 'pending',
                        'the second request completed after the first');
                    ok(c.first().get('required_field') === 'changed value',
                        'required field is set to original value');
                });

                dfd4.then(function() {
                    equal(dfd3.state(), 'resolved',
                        'the first request completed before the second');
                    equal(c.first().get('required_field'), 'changed value 2');
                    start();
                });
            });
        });

    });

    asyncTest('conditional refresh after loading via collection', function() {
        setup().then(function(c) {
            var promise = c.first().refresh(null, {conditional: true});

            ok(promise.state(), 'resolved');

            promise.then(function() {
                ok(true, 'didnt fail');
                start();
            });
        });
    });

    asyncTest('refreshing a model without id returns a failed deferred', function() {
        setup({noCollection: true}).then(function() {
            var m = Example(), dfd = m.refresh();

            ok(m.get('id') == null, 'model has no id');
            equal(dfd.state(), 'rejected', 'deferred has been rejected');

            dfd.then(function() {
                ok(false, 'deferred should not resolve');
                start();
            }, function() {
                ok(true, 'error callback should execute');
                start();
            });
        });
    });

    module('save');

    asyncTest('saving a value on an existing model works', function() {
        setup().then(function(c) {
            ok(c.first().get('required_field') == null);
            c.first().set('required_field', 'foo');
            c.first().save().then(function() {
                Example.models.clear();
                Example.collection().load().then(function(models) {
                    equal(models[0].get('required_field'), 'foo');
                    start();
                });
            });
        });
    });

    asyncTest('saving a value on a new model works', function() {
        setup({noCollection: true}).then(function() {
            var m = Example();
            m.set('required_field', 'foo');
            m.save().then(function() {
                var id = m.get('id');
                Example.models.clear();
                Example.collection().load().then(function(models) {
                    var m = _.find(models, function(m) {
                        return m.get('id') == id;
                    });
                    ok(m);
                    equal(m.get('required_field'), 'foo');
                    start();
                });
            });
        });
    });

    asyncTest('calling save with in flight create returns first dfd', function() {
        setup({noCollection: true}).then(function() {
            Example.mockDelay(10);
            var m = Example({required_field: 'foo'}),
                dfd1 = m.save(),
                dfd2 = m.save();
            ok(dfd1 === dfd2, 'second save\'s dfd is equal to the first');
            dfd1.then(function() {
                start();
            }, function() {
                ok(false, 'should have resolved');
                start();
            });
        });
    });

    asyncTest('calling save fails when theres an in flight create that fails', function() {
        setup({noCollection: true}).then(function() {
            Example.mockDelay(10);
            var m = Example({required_field: 'foo'}), dfd1, dfd2, dfd1Failed;
            Example.mockFailure(true);
            dfd1 = m.save();
            m.set('text_field', 'bar');
            dfd2 = m.save();
            ok(dfd1 !== dfd2, 'second save\'s dfd is not equal to the first');
            dfd1.then(function() {
                ok(false, 'should have failed');
            }, function() {
                ok(true, 'first deferred should have failed');
                dfd1Failed = true;
            });
            dfd1.then(function() {
                ok(false, 'second deferred should have failed');
                start();
            }, function() {
                ok(true, 'first deferred should have failed');
                ok(dfd1Failed);
                start();
            });
        });
    });

    asyncTest('calling save on already-loaded model another', function() {
        setup().then(function(c) {
            c.first().save().then(function() {
                ok(true, 'saved succeeded');
                start();
            });
        });
    });

    asyncTest('cleaning up state after save', function() {
        setup({noCollection: true}).then(function() {
            var m = Example({required_field: 'foo'});
            m.save().then(function() {
                m.set({required_field: 'bar'});
                m.save().then(function() {
                    equal(m._inFlight.save.length, 1);
                    start();
                });
            });
        });
    });

    asyncTest('calling save on existing model with in flight update returns first dfd', function() {
        setup().then(function(c) {
            Example.mockDelay(10);
            var dfd1, dfd2;
            c.first().set('required_field', 'foo');
            dfd1 = c.first().save();
            dfd2 = c.first().save();
            ok(dfd1 === dfd2, 'second save\'s dfd is equal to the first');
            dfd1.then(function() {
                start();
            }, function() {
                ok(false, 'should have resolved');
                start();
            });
        });
    });

    asyncTest('calling save on new model with in flight create returns first dfd', function() {
        setup({noCollection: true}).then(function() {
            Example.mockDelay(10);
            var m = Example(), dfd1, dfd2;

            m.set('required_field', 'foo');

            dfd1 = m.save();
            dfd2 = m.save();

            ok(dfd1 === dfd2, 'second save\'s dfd is equal to the first');
            dfd1.then(function() {
                start();
            }, function() {
                ok(false, 'should have resolved');
                start();
            });
        });
    });

    asyncTest('failed save restores changes to local model', function() {
        setup().then(function(c) {
            var m = c.first(), dfd1, dfd2;

            Example.mockDelay(50).mockFailure(true);
            m.set('required_field', 'foo');
            dfd1 = m.save();
            Example.mockFailure(false);
            m.set('text_field', 'bar');
            dfd2 = m.save();

            dfd1.then(function() {
                ok(false, 'first request should have failed');
            }, function() {
                ok(true, 'first request failed');
                equal(m._changes.required_field, true,
                    'required_field property is listed as changed');
            });

            dfd2.then(function() {
                ok(true, 'second request succeeded');
                equal(m._changes.hasOwnProperty('text_field'), false,
                    'text_field property is not listed as changed');
                start();
            }, function() {
                ok(false, 'second request should not have failed');
                start();
            });
        });
    });

    asyncTest('calling save with in flight create and changes returns new dfd', function() {
        setup({noCollection: true}).then(function() {
            Example.mockDelay(50);
            var m = Example(), dfd1, dfd2;

            m.set('required_field', 'foo');
            dfd1 = m.save(),
            m.set('boolean_field', true);
            dfd2 = m.save();

            ok(dfd1 !== dfd2, 'different deferred objects');

            dfd1.then(function() {
                var persisted = Example.mockGetPersistedData(), checked = false;
                equal(dfd2.state(), 'pending');
                equal(m.get('required_field'), 'foo');
                equal(m.get('boolean_field'), true);
                _.each(persisted, function(d) {
                    if (d.id === m.get('id')) {
                        checked = true;
                        equal(d.required_field, 'foo',
                            'required_field has been persisted');
                        ok(d.boolean_field == null,
                            'boolean_field has not been persisted');
                    }
                });
                ok(checked, 'successfully checked persisted data');
            });

            dfd2.then(function() {
                var persisted = Example.mockGetPersistedData(), checked = false;
                equal(dfd1.state(), 'resolved');
                equal(m.get('required_field'), 'foo');
                equal(m.get('boolean_field'), true);
                _.each(persisted, function(d) {
                    if (d.id === m.get('id')) {
                        checked = true;
                        equal(d.required_field, 'foo',
                            'required_field has been persisted');
                        equal(d.boolean_field, true,
                            'boolean_field has been persisted');
                    }
                });
                ok(checked, 'successfully checked persisted data');
                start();
            });

        });
    });

    asyncTest('calling save with in flight update and changes returns new dfd', function() {
        setup().then(function(c) {
            Example.mockDelay(10);
            var dfd1, dfd2;

            c.first().set('required_field', 'foo');
            dfd1 = c.first().save(),
            c.first().set('boolean_field', true);
            dfd2 = c.first().save();

            ok(dfd1 !== dfd2, 'different deferred objects');

            dfd1.then(function() {
                equal(dfd2.state(), 'pending');
                equal(c.first().get('required_field'), 'foo');
                equal(c.first().get('boolean_field'), true);
            });

            dfd2.then(function() {
                equal(dfd1.state(), 'resolved');
                equal(c.first().get('required_field'), 'foo');
                equal(c.first().get('boolean_field'), true);
                start();
            });

        });
    });

    asyncTest('updating a nested property', function() {
        setup({resource: NestedPolymorphicExample}).then(function(c) {
            var data, m = c.first();
            data = _.find(NestedPolymorphicExample.mockGetPersistedData(),
                function(d) {
                    return d.id === m.get('id');
                });
            ok(data);
            m.set('structure_field.required_field', 1335);
            equal(data.structure_field.required_field, 0);
            m.save().then(function() {
                var newData = _.find(NestedPolymorphicExample.mockGetPersistedData(),
                    function(d) {
                        return d.id === m.get('id');
                    });
                ok(newData);
                equal(newData.structure_field.required_field, 1335);
                start();
            }, function(e) {
                ok(false, 'save failed');
                throw e;
            });
        });
    });

    module('delete');

    asyncTest('calling delete with in flight requests returns current promise', function() {
        setup().then(function(c) {
            Example.mockDelay(10);
            var dfd1 = c.first().destroy(),
                dfd2 = c.first().destroy();

            ok(dfd1 === dfd2, 'same promise is returned');
            equal(dfd1.state(), 'pending', 'promises in "pending" state');

            dfd1.then(function() {
                start();
            });
        });
    });

    asyncTest('calling delete after successful delete returns same promise', function() {
        setup().then(function(c) {
            Example.mockDelay(10);
            var m = c.first(),
                dfd1 = m.destroy();

            equal(dfd1.state(), 'pending', 'initial deferred state is pending');

            dfd1.then(function() {
                var dfd2 = m.destroy();
                ok(true, 'first destroy succeeded');
                ok(dfd1 === dfd2, 'second deferred is the same as the first');
                equal(dfd2.state(), 'resolved',
                    'second deferred state is resolved');
                start();
            });
        });
    });

    asyncTest('calling delete after failed delete returns new promise', function() {
        setup().then(function(c) {
            Example.mockFailure(true);
            var m = c.first(), dfd1 = m.destroy();

            dfd1.then(function() {
                ok(false, 'destroy should have failed');
                start();
            }, function() {
                Example.mockFailure(false);
                var dfd2 = m.destroy();
                ok(dfd1 !== dfd2);
                dfd2.then(function() {
                    ok(true);
                    start();
                });
            });
        });
    });

    asyncTest('calling delete and then save and then delete', function() {
        setup().then(function(c) {
            Example.mockDelay(10);
            var m = c.currentPage()[1],
                originalId = c.get('id'),
                dfd1 = m.destroy();

            equal(dfd1.state(), 'pending', 'delete request is pending');

            dfd1.then(function() {
                var persisted = Example.mockGetPersistedData();
                ok(!_.find(persisted, function(d) {
                    return d.id === originalId;
                }), 'the model is not in the persisted data');
                Example.models.clear();
                var c = Example.collection();
                c.load().then(function() {
                    ok(!c.where({id: originalId}),
                        'the model is not loaded from the persisted data');
                    m.save().then(function() {
                        c.load({reload: true}).then(function() {
                            var newM = c.where({id: m.get('id')}), dfd2;
                            ok(newM,
                                'after re-loading the collection, the model is back');
                            if (newM) {
                                equal(newM.get('text_field'), m.get('text_field'));
                            }

                            dfd2 = m.destroy();
                            ok(dfd1 !== dfd2, 'a new delete request is executed');

                            dfd2.then(function() {
                                equal(m._inFlight.destroy.length, 1,
                                    'cleaning up state');
                                start();
                            });
                        });
                    });
                });
            });
        });
    });

    module('load');

    asyncTest('calling load refreshes with unloaded model and retuns cached result otherwise', function() {
        setup({noCollection: true}).then(function() {
            var m = Example.models.get(1), dfd1 = m.load();

            dfd1.then(function() {
                var dfd2 = m.load();
                ok(dfd1 === dfd2, 'second load returns cached promise');
                equal(dfd2.state(), 'resolved');
                start();
            });
        });
    });

    // module('_fieldFromPropName');

    // test('correctly translates nested property to field', function() {

    // });

    module('set with validate');

    // asyncTest('dont set invalid options', function() {
    //     setup().then(function(c) {
    //         var changeCount = 0,
    //             managerChangeCount = 0,
    //             m = c.models[1],
    //             orig = m.get('integer_field');
    //         m.on('change', function() { changeCount++; });
    //         Example.models.on('change', function() { managerChangeCount++; });
    //         m.set({integer_field: 'abc'}, {validate: true});
    //         equal(changeCount, 0, 'model didnt fire change events');
    //         equal(managerChangeCount, 0, 'manager didnt fire change events');
    //         equal(m.get('integer_field'), orig, 'integer_field value didnt change');
    //         start();
    //     });
    // });

    // TODO:
    //  - preserve original value on failed set
    //  - when there's existing validation issue, setting other values

    start();
});
