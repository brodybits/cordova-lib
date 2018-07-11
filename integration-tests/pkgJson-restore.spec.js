/**
    Licensed to the Apache Software Foundation (ASF) under one
    or more contributor license agreements.  See the NOTICE file
    distributed with this work for additional information
    regarding copyright ownership.  The ASF licenses this file
    to you under the Apache License, Version 2.0 (the
    "License"); you may not use this file except in compliance
    with the License.  You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing,
    software distributed under the License is distributed on an
    "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, either express or implied.  See the License for the
    specific language governing permissions and limitations
    under the License.
*/

const path = require('path');
const fs = require('fs-extra');
const prepare = require('../src/cordova/prepare');
const cordovaPlugin = require('../src/cordova/plugin');
const cordovaPlatform = require('../src/cordova/platform');
const { ConfigParser } = require('cordova-common');
const { listPlatforms, requireNoCache } = require('../src/cordova/util');
const { tmpDir: getTmpDir, testPlatform, setDefaultTimeout } = require('../spec/helpers');

// XXX
var helpers = require('../spec/helpers');
var shell = require('shelljs');
var events = require('cordova-common').events;
var cordova_util = require('../src/cordova/util');
var TIMEOUT = 240 * 1000;

/** Testing will check if "cordova prepare" is restoring platforms and plugins as expected.
*   Uses different basePkgJson files depending on testing expecations of what (platforms/plugins/variables)
*   should initially be in pkg.json and/or config.xml.
*/
describe('restore', function () {
    setDefaultTimeout(240 * 1000);

    const fixturesPath = path.join(__dirname, '../spec/cordova/fixtures');
    var tmpDir, project, pkgJsonPath, configXmlPath;

    beforeEach(() => {
        tmpDir = getTmpDir('pkgJson');
        project = path.join(tmpDir, 'project');
        pkgJsonPath = path.join(project, 'package.json');
        configXmlPath = path.join(project, 'config.xml');
        delete process.env.PWD;
    });

    afterEach(() => {
        process.chdir(__dirname); // Needed to rm the dir on Windows.
        fs.removeSync(tmpDir);
    });

    function setupProject (name) {
        fs.copySync(path.join(fixturesPath, name), project);
        process.chdir(project);
    }

    function getCfg () {
        expect(configXmlPath).toExist();
        return new ConfigParser(configXmlPath);
    }

    function getCfgEngineNames (cfg = getCfg()) {
        return cfg.getEngines().map(({ name }) => name);
    }

    function getPkgJson (propPath) {
        expect(pkgJsonPath).toExist();
        const keys = propPath ? propPath.split('.') : [];
        return keys.reduce((obj, key) => {
            expect(obj).toBeDefined();
            return obj[key];
        }, requireNoCache(pkgJsonPath));
    }

    function platformPkgName (platformName) {
        return platformName.replace(/^(?:cordova-)?/, 'cordova-');
    }

    function pluginPath (pluginName) {
        return path.join(project, 'plugins', pluginName);
    }

    function installedPlatforms () {
        // Sort platform list to allow for easy pseudo set equality
        return listPlatforms(project).sort();
    }

    function expectPluginsInPkgJson (plugins) {
        const pkgJson = getPkgJson();
        expect(pkgJson).toBeDefined();

        // Check that cordova.plugins key in package.json contains the expected
        // variables and ONLY them
        const variables = plugins.reduce((o, {name, variables}) => {
            o[name] = variables;
            return o;
        }, {});
        expect(pkgJson.cordova).toBeDefined();
        expect(pkgJson.cordova.plugins).toEqual(variables);

        // Check that dependencies key in package.json contains the expected specs
        // We only check the specs for plugins where an expected spec was given
        const specs = plugins.reduce((o, {name, spec}) => {
            if (spec) o[name] = spec;
            return o;
        }, {});
        if (Object.keys(specs).length > 0) {
            expect(pkgJson.dependencies).toEqual(jasmine.objectContaining(specs));
        }
    }

    function expectConsistentPlugins (plugins) {
        expect(getCfg().getPlugins()).toEqual(plugins);

        const unwrappedPlugins = plugins.map(p => p.sample || p);
        expectPluginsInPkgJson(unwrappedPlugins);

        const pluginNames = unwrappedPlugins.map(({ name }) => name);
        pluginNames.forEach(name => expect(pluginPath(name)).toExist());
    }

    // Use basePkgJson
    describe('with --save', function () {
        beforeEach(() => setupProject('basePkgJson'));

        /** Test#000 will check that when a platform is added with a spec, it will
        *   add to pkg.json with a '^' and to config.xml with a '~'. When prepare is run,
        *   pkg.json will have no change and config.xml (first char) will change from a '~' to a '^'.
        */
        it('Test#000 : tests that the spec (~,^) is added and updated as expected in config.xml', function () {
            const PLATFORM = 'android';

            expect(installedPlatforms()).toEqual([]);

            return cordovaPlatform('add', PLATFORM, {save: true}).then(function () {
                // When spec is added to pkg.json, first char is '^'.
                const pkgJson = getPkgJson();
                expect(pkgJson.cordova.platforms).toEqual([PLATFORM]);
                expect(pkgJson.dependencies[platformPkgName(PLATFORM)]).toMatch(/^\^/);

                // When spec is added to config.xml, first char is '~'.
                expect(getCfg().getEngines()).toEqual([jasmine.objectContaining({
                    name: PLATFORM,
                    spec: jasmine.stringMatching(/^~/)
                })]);
            }).then(function () {
                return prepare();
            }).then(function () {
                // No changes to pkg.json spec for android.
                const pkgJson = getPkgJson();
                expect(pkgJson.cordova.platforms).toEqual([PLATFORM]);
                expect(pkgJson.dependencies[platformPkgName(PLATFORM)]).toMatch(/^\^/);

                // config.xml spec should change from '~' to '^'.
                expect(getCfg().getEngines()).toEqual([jasmine.objectContaining({
                    name: PLATFORM,
                    spec: jasmine.stringMatching(/^\^/)
                })]);
            });
        }, 300000);

        /** Test#017
        *   When platform is added with url and fetch and restored with fetch,
        *   pkg.json and config.xml would add it to their files properly.
        *   When prepare is run with fetch, platform should be installed.
        */
        it('Test#017 : test to make sure that platform url is added and restored properly', function () {
            const PLATFORM = 'browser';
            const PLATFORM_URL = 'https://github.com/apache/cordova-browser';

            expect(installedPlatforms()).toEqual([]);

            return Promise.resolve().then(function () {
                // Add platform with save and fetch
                return cordovaPlatform('add', PLATFORM_URL, {save: true});
            }).then(function () {
                // Check that platform was added to config.xml successfully.
                expect(getCfg().getEngines()).toEqual([jasmine.objectContaining({
                    name: PLATFORM,
                    spec: PLATFORM_URL
                })]);

                // Check that platform was added to pkg.json successfully.
                const pkgJson = getPkgJson();
                expect(pkgJson.cordova.platforms).toEqual([PLATFORM]);
                expect(pkgJson.dependencies[platformPkgName(PLATFORM)]).toEqual(`git+${PLATFORM_URL}.git`);
            }).then(function () {
                // Remove platform without --save.
                return cordovaPlatform('rm', PLATFORM);
            }).then(function () {
                // Platform in pkg.json should still be there.
                const pkgJson = getPkgJson();
                expect(pkgJson.cordova.platforms).toEqual([PLATFORM]);
                expect(pkgJson.dependencies[platformPkgName(PLATFORM)]).toEqual(`git+${PLATFORM_URL}.git`);
            }).then(function () {
                return prepare();
            }).then(function () {
                // Check config.xml for spec modification.
                expect(getCfg().getEngines()).toEqual([jasmine.objectContaining({
                    name: PLATFORM,
                    spec: `git+${PLATFORM_URL}.git`
                })]);
                // No change to pkg.json.
                const pkgJson = getPkgJson();
                expect(pkgJson.cordova.platforms).toEqual([PLATFORM]);
                expect(pkgJson.dependencies[platformPkgName(PLATFORM)]).toEqual(`git+${PLATFORM_URL}.git`);
            });
        });

        /** Test#018
        *   When plugin is added with url and fetch and restored with fetch,
        *   pkg.json and config.xml would add it to their files properly.
        *   When prepare is run with fetch, plugin should be installed.
        */
        it('Test#018 : test to make sure that plugin url is added and restored properly', function () {
            const PLUGIN_ID = 'cordova-plugin-splashscreen';
            const PLUGIN_URL = 'https://github.com/apache/cordova-plugin-splashscreen';

            expect(installedPlatforms()).toEqual([]);

            return Promise.resolve().then(function () {
                // Add plugin with save and fetch.
                return cordovaPlugin('add', PLUGIN_URL, {save: true});
            }).then(function () {
                // Plugin was installed and added to config.xml and pkg.json
                expect(getCfg().getPlugins()).toEqual([{
                    name: PLUGIN_ID,
                    spec: PLUGIN_URL,
                    variables: jasmine.any(Object)
                }]);
                expectPluginsInPkgJson([{
                    name: PLUGIN_ID,
                    spec: `git+${PLUGIN_URL}.git`,
                    variables: jasmine.any(Object)
                }]);
                expect(pluginPath(PLUGIN_ID)).toExist();
            }).then(function () {
                // Remove plugin without --save.
                return cordovaPlugin('rm', PLUGIN_ID);
            }).then(function () {
                // config.xml and pkg.json remain unchanged
                expect(getCfg().getPlugins()).toEqual([{
                    name: PLUGIN_ID,
                    spec: PLUGIN_URL,
                    variables: jasmine.any(Object)
                }]);
                expectPluginsInPkgJson([{
                    name: PLUGIN_ID,
                    spec: `git+${PLUGIN_URL}.git`,
                    variables: jasmine.any(Object)
                }]);
                // Plugin was removed from the installed plugin list successfully.
                expect(pluginPath(PLUGIN_ID)).not.toExist();
            }).then(function () {
                // Add platform (so that prepare can run).
                return cordovaPlatform('add', 'browser', {save: true});
            }).then(function () {
                return prepare({save: true});
            }).then(function () {
                // Config.xml spec now matches the one in pkg.json.
                expectConsistentPlugins([{
                    name: PLUGIN_ID,
                    spec: `git+${PLUGIN_URL}.git`,
                    variables: jasmine.any(Object)
                }]);
            });
        });

        /** Test#003 will add two platforms to package.json - one with the 'save' flag and one
        *   without the 'save' flag. It will remove both platforms without a 'save' flag.
        *   After running cordova prepare, only the platform added with the 'save' flag is restored
        *   in platforms.json.
        */
        it('Test#003 : should NOT restore platform that was not saved and removed', function () {
            const PLATFORM_1 = 'ios';
            const PLATFORM_2 = 'browser';

            expect(installedPlatforms()).toEqual([]);

            return Promise.resolve().then(function () {
                // Add PLATFORM_1 platform to project without --save
                return cordovaPlatform('add', PLATFORM_1);
            }).then(function () {
                // Add PLATFORM_2 to project with --save
                return cordovaPlatform('add', PLATFORM_2, {save: true});
            }).then(function () {
                // Both platforms are installed but only PLATFORM_2 is in pkg.json
                expect(installedPlatforms()).toEqual([PLATFORM_2, PLATFORM_1]);
                expect(getPkgJson('cordova.platforms')).toEqual([PLATFORM_2]);
            }).then(function () {
                // Remove all platforms without --save.
                return cordovaPlatform('rm', [PLATFORM_1, PLATFORM_2]);
            }).then(function () {
                // Check that the platform that was added with --save is still in package.json.
                expect(getPkgJson('cordova.platforms')).toEqual([PLATFORM_2]);
            }).then(function () {
                return prepare();
            });
        });
    });

    describe('without --save', function () {

        /** Test#004 will check the platform list in package.json and config.xml.
        *   When both files contain the same platforms and cordova prepare is run,
        *   neither file is modified.
        */
        it('Test#004 : if pkg.json and config.xml have the same platforms, do not modify either file', function () {
            setupProject('basePkgJson6');
            expect(installedPlatforms()).toEqual([]);

            // Pkg.json and config.xml contain only android at this point (basePkgJson6).
            return Promise.resolve().then(function () {
                return prepare();
            }).then(function () {
                // Expect pkg.json and config.xml to both include only android.
                expect(getCfgEngineNames()).toEqual(['android']);
                expect(getPkgJson('cordova.platforms')).toEqual(['android']);
            });
        });

        /** Test#005 will check the platform list in package.json and config.xml.
        *   When config.xml has 'android and browser' and pkg.json only contains 'android', run cordova
        *   and pkg.json is updated to include 'browser'. This test will also check that pkg.json
        *   is updated with the correct spec/dependencies when restored. Checks that specs are
        *   added properly, too.
        */
        it('Test#005 : if config.xml has android & browser platforms and pkg.json has android, update pkg.json to also include browser with spec', function () {
            setupProject('basePkgJson5');

            const PLATFORM_1 = 'android';
            const PLATFORM_2 = 'browser';

            { // Block is to limit variable scope
                const pkgJson = getPkgJson();

                // Config.xml contains(android & browser) and pkg.json contains android (basePkgJson5).
                expect(installedPlatforms()).toEqual([]);
                expect(getCfgEngineNames()).toEqual([PLATFORM_1, PLATFORM_2]);
                expect(pkgJson.cordova.platforms).toEqual([PLATFORM_1]);
                expect(pkgJson.dependencies[platformPkgName(PLATFORM_1)]).toBeUndefined();
                expect(pkgJson.dependencies[platformPkgName(PLATFORM_2)]).toBeUndefined();
            }

            return prepare().then(function () {
                const pkgJson = getPkgJson();
                // Expect both pkg.json and config.xml to each have both platforms in their arrays.
                expect(getCfgEngineNames()).toEqual([PLATFORM_1, PLATFORM_2]);
                expect(pkgJson.cordova.platforms).toEqual([PLATFORM_1, PLATFORM_2]);
                // Platform specs from config.xml have been added to pkg.json.
                expect(pkgJson.dependencies).toEqual(jasmine.objectContaining({
                    [platformPkgName(PLATFORM_1)]: '7.0.0',
                    [platformPkgName(PLATFORM_2)]: '^5.0.3'
                }));
            });
        });

        /** Test#006 will check if pkg.json has a cordova key and platforms installed already.
         *   If it does not and config.xml has a platform(s) installed already, run cordova prepare
         *   and it will add a cordova key and the platform(s) from config.xml to package.json.
         */
        it('Test#006 : if pkg.json exists without cordova key, create one with same platforms in config.xml ', function () {
            setupProject('basePkgJson3');

            expect(installedPlatforms()).toEqual([]);
            expect(getCfgEngineNames()).toEqual(['android']);
            // Expect that pkg.json exists without a cordova key.
            expect(getPkgJson('cordova')).toBeUndefined();

            return prepare().then(function () {
                // Expect no change to config.xml.
                expect(getCfgEngineNames()).toEqual(['android']);
                // Expect cordova key and 'android' platform to be added to pkg.json.
                expect(getPkgJson('cordova.platforms')).toEqual(['android']);
            });
        });

        /** Test#007 will check the platform list in package.json and config.xml.
        *   When package.json has 'android and browser' and config.xml only contains 'android', run cordova
        *   and config.xml is updated to include 'browser'. Also, if there is a specified spec in pkg.json,
        *   it should be added to config.xml during restore.
        */
        it('Test#007 : if pkgJson has android & browser platforms and config.xml has android, update config to also include browser and spec', function () {
            setupProject('basePkgJson4');

            expect(installedPlatforms()).toEqual([]);
            expect(getCfgEngineNames()).toEqual(['ios']);
            expect(getPkgJson('dependencies')).toEqual({
                'cordova-ios': '^4.5.4', 'cordova-browser': '^5.0.3'
            });

            return prepare().then(function () {
                // Check to make sure that 'browser' spec was added properly.
                expect(getCfg().getEngines()).toEqual([
                    { name: 'ios', spec: '^4.5.4' },
                    { name: 'browser', spec: '^5.0.3' }
                ]);
                // No change to pkg.json dependencies.
                expect(getPkgJson('dependencies')).toEqual({
                    'cordova-ios': '^4.5.4', 'cordova-browser': '^5.0.3'
                });
            });
        });
    });

    // These tests will check the plugin/variable list in package.json and config.xml.
    describe('plugins', function () {

        /**
        *   When pkg.json and config.xml define different values for a plugin variable,
        *   pkg.json should win and that value will be used to replace config's value.
        */
        it('Test#011 : if pkg.Json has 1 plugin and 1 variable, update config.xml to include these variables', function () {
            setupProject('basePkgJson8');

            expect(getCfg().getPlugins()).toEqual([
                jasmine.objectContaining({
                    name: 'cordova-plugin-camera',
                    variables: { variable_1: 'config' }
                })
            ]);
            expect(getPkgJson('cordova.plugins')).toEqual({
                'cordova-plugin-camera': { variable_1: 'json' }
            });
            expect(installedPlatforms()).toEqual([]);

            return prepare({save: true}).then(function () {
                expectConsistentPlugins([
                    jasmine.objectContaining({
                        name: 'cordova-plugin-camera',
                        variables: { variable_1: 'json' }
                    })
                ]);
            });
        });

        /**
        *   When config.xml and pkg.json share a common plugin but pkg.json defines no variables for it,
        *   prepare will update pkg.json to match config.xml's plugins/variables.
        */
        it('Test#012 : if pkg.Json has 1 plugin and 2 variables, update config.xml to include these plugins/variables', function () {
            setupProject('basePkgJson9');

            expect(getCfg().getPlugins()).toEqual([
                jasmine.objectContaining({
                    name: 'cordova-plugin-camera',
                    variables: { variable_1: 'value_1' }
                })
            ]);
            expect(getPkgJson('cordova.plugins')).toEqual({
                'cordova-plugin-camera': {}
            });
            expect(installedPlatforms()).toEqual([]);

            return prepare({save: true}).then(function () {
                expectConsistentPlugins([
                    jasmine.objectContaining({
                        name: 'cordova-plugin-camera',
                        variables: { variable_1: 'value_1' }
                    })
                ]);
            });
        });

        /**
        *   For plugins that are the same, it will merge their variables together for the final list.
        *   Plugins that are unique to that file, will be copied over to the file that is missing it.
        *   Config.xml and pkg.json will have identical plugins and variables after cordova prepare.
        */
        it('Test#013 : update pkg.json AND config.xml to include all plugins and merge unique variables', function () {
            setupProject('basePkgJson10');

            expect(getCfg().getPlugins()).toEqual([
                jasmine.objectContaining({
                    name: 'cordova-plugin-camera',
                    variables: { variable_3: 'value_3' }
                }),
                jasmine.objectContaining({
                    name: 'cordova-plugin-splashscreen',
                    variables: {}
                })
            ]);
            expect(getPkgJson('cordova.plugins')).toEqual({
                'cordova-plugin-splashscreen': {},
                'cordova-plugin-camera': { variable_1: ' ', variable_2: ' ' },
                'cordova-plugin-device': { variable_1: 'value_1' }
            });
            expect(installedPlatforms()).toEqual([]);

            return prepare({save: true}).then(function () {
                expectConsistentPlugins([
                    jasmine.objectContaining({
                        name: 'cordova-plugin-camera',
                        variables: { variable_1: ' ', variable_2: ' ', variable_3: 'value_3' }
                    }),
                    jasmine.objectContaining({
                        name: 'cordova-plugin-splashscreen',
                        variables: {}
                    }),
                    jasmine.objectContaining({
                        name: 'cordova-plugin-device',
                        variables: { variable_1: 'value_1' }
                    })
                ]);
            });
        });

        /**
        *   If either file is missing a plugin, it will be added with the correct variables.
        *   If there is a matching plugin name, the variables will be merged and then added
        *   to config and pkg.json.
        */
        it('Test#014 : update pkg.json AND config.xml to include all plugins and merge variables (no dupes)', function () {
            setupProject('basePkgJson11');

            expect(getCfg().getPlugins()).toEqual([{
                name: 'cordova-plugin-camera',
                spec: '~2.2.0',
                variables: { variable_1: 'value_1', variable_2: 'value_2' }
            }, {
                name: 'cordova-plugin-device',
                spec: '~1.0.0',
                variables: {}
            }]);
            expectPluginsInPkgJson([{
                name: 'cordova-plugin-camera',
                spec: '^2.3.0',
                variables: { variable_1: 'value_1', variable_3: 'value_3' }
            }, {
                name: 'cordova-plugin-splashscreen',
                variables: {}
            }]);
            expect(installedPlatforms()).toEqual([]);

            return prepare({save: true}).then(function () {
                expectConsistentPlugins([{
                    name: 'cordova-plugin-camera',
                    spec: '^2.4.1',
                    variables: { variable_1: 'value_1', variable_2: 'value_2', variable_3: 'value_3' }
                }, {
                    name: 'cordova-plugin-device',
                    spec: '^1.0.1',
                    variables: {}
                }, {
                    name: 'cordova-plugin-splashscreen',
                    spec: jasmine.any(String),
                    variables: {}
                }]);
            });
        });

        /**
        *   When config has no plugins and is restored, the plugins will be restored with the
        *   pkg.json plugins and with the spec from pkg.json dependencies.
        */
        it('Test#015 : update config.xml to include all plugins/variables from pkg.json', function () {
            setupProject('basePkgJson12');

            // config.xml is initially empty and has no plugins.
            expect(getCfg().getPlugins()).toEqual([]);

            expectPluginsInPkgJson([{
                name: 'cordova-plugin-camera',
                spec: '^2.3.0',
                variables: { variable_1: 'value_1' }
            }]);
            expect(installedPlatforms()).toEqual([]);

            return prepare({save: true}).then(function () {
                expectConsistentPlugins([{
                    name: 'cordova-plugin-camera',
                    spec: '^2.4.1',
                    variables: { variable_1: 'value_1' }
                }]);
            });
        });
    });
});

// Use basePkgJson13 - does NOT have a package.json
describe('platforms and plugins should be restored with config.xml even without a pkg.json', function () {
    var tmpDir = helpers.tmpDir('platform_test_pkgjson');
    var project = path.join(tmpDir, 'project');
    var results;
    var listener = function (res) { results = res; };

    beforeEach(function () {
        shell.rm('-rf', tmpDir);
        // Copy then move because we need to copy everything, but that means it will copy the whole directory.
        // Using /* doesn't work because of hidden files.
        // Use basePkgJson13 because pkg.json and config.xml contain only android
        shell.cp('-R', path.join(__dirname, '..', 'spec', 'cordova', 'fixtures', 'basePkgJson13'), tmpDir);
        shell.mv(path.join(tmpDir, 'basePkgJson13'), project);
        process.chdir(project);
        events.on('results', listener);
    });

    afterEach(function () {
        events.removeListener('results', listener);
        process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
        shell.rm('-rf', tmpDir);
    });

    // Factoring out some repeated checks.
    function emptyPlatformList () {
        return cordovaPlatform('list').then(function () {
            var installed = results.match(/Installed platforms:\n {2}(.*)/);
            expect(installed).toBeDefined();
            expect(installed[1].indexOf(helpers.testPlatform)).toBe(-1);
        });
    }
    /** Test#016 will check that cordova prepare will still restore the correct
    *   platforms and plugins even without package.json file.
    */
    it('Test#016 : platforms and plugins should be restored with config.xml even without a pkg.json', function () {
        var cwd = process.cwd();
        var configXmlPath = path.join(cwd, 'config.xml');
        var cfg1 = new ConfigParser(configXmlPath);
        var engines = cfg1.getEngines();
        var engNames = engines.map(function (elem) {
            return elem.name;
        });
        var configEngArray = engNames.slice();
        var configPlugins = cfg1.getPluginIdList();
        var pluginsFolderPath16 = path.join(cwd, 'plugins');
        var androidPlatform = 'android';
        var browserPlatform = 'windows';

        // Pkg.json does not exist.
        expect(path.join(cwd, 'package.json')).not.toExist();
        // Config.xml contains only contains 'android' at this point (basePkgJson13).
        expect(configEngArray.length === 1);
        // Config.xml contains only 1 plugin at this point.
        expect(Object.keys(configPlugins).length === 1);

        return emptyPlatformList().then(function () {
            // Run platform add.
            return cordovaPlatform('add', browserPlatform, {'save': true});
        }).then(function () {
            // Android and browser are in config.xml.
            var cfg3 = new ConfigParser(configXmlPath);
            engines = cfg3.getEngines();
            engNames = engines.map(function (elem) {
                return elem.name;
            });
            configEngArray = engNames.slice();
            expect(configEngArray.length === 2);
            // Package.json should be auto-created.
            expect(path.join(cwd, 'package.json')).toExist();
            var pkgJsonPath = path.join(cwd, 'package.json');
            delete require.cache[require.resolve(pkgJsonPath)];
            var pkgJson = require(pkgJsonPath);
            // Expect that pkgJson name, version, and displayName should use
            // config.xml's id, version, and name.
            expect(pkgJson.name).toEqual(cfg3.packageName().toLowerCase());
            expect(pkgJson.version).toEqual(cfg3.version());
            expect(pkgJson.displayName).toEqual(cfg3.name());
            // Remove android without --save.
            return cordovaPlatform('rm', [browserPlatform]);
        }).then(function () {
            // Run cordova prepare.
            return prepare();
        }).then(function () {
            var cfg2 = new ConfigParser(configXmlPath);
            engines = cfg2.getEngines();
            engNames = engines.map(function (elem) {
                return elem.name;
            });
            configEngArray = engNames.slice();
            // Config.xml should have android and browser.
            expect(configEngArray.indexOf(androidPlatform)).toBeGreaterThan(-1);
            expect(configEngArray.indexOf(browserPlatform)).toBeGreaterThan(-1);
            expect(configEngArray.length === 2);
        }).then(function () {
            // Check plugins.
            var cfg5 = new ConfigParser(configXmlPath);
            engines = cfg5.getEngines();
            engNames = engines.map(function (elem) {
                return elem.name;
            });
            configEngArray = engNames.slice();
            // Config.xml contains only one plugin.
            expect(Object.keys(configPlugins).length === 1);
            expect(configPlugins.indexOf('cordova-plugin-device')).toEqual(0);
            // Expect device plugin to be in the installed list.
            expect(path.join(pluginsFolderPath16, 'cordova-plugin-device')).toExist();
        }).then(function () {
            // Remove plugin without save.
            return cordovaPlugin('rm', 'cordova-plugin-device');
        }).then(function () {
            var cfg4 = new ConfigParser(configXmlPath);
            engines = cfg4.getEngines();
            engNames = engines.map(function (elem) {
                return elem.name;
            });
            configEngArray = engNames.slice();
            // Config.xml plugins are the same.
            expect(Object.keys(configPlugins).length === 1);
            expect(configPlugins.indexOf('cordova-plugin-device')).toEqual(0);
            // Plugin should be removed from the installed list.
            expect(path.join(pluginsFolderPath16, 'cordova-plugin-device')).not.toExist();
        }).then(function () {
            // Run cordova prepare.
            return prepare();
        }).then(function () {
            // Plugin should be restored and returned to the installed list.
            expect(path.join(pluginsFolderPath16, 'cordova-plugin-device')).toExist();
        });
    // Cordova prepare needs extra wait time to complete.
    }, TIMEOUT);
});

// Use basePkgJson
describe('tests platform/spec restore with --save', function () {
    var tmpDir = helpers.tmpDir('platform_test_pkgjson2');
    var project = path.join(tmpDir, 'project');
    var results;
    var listener = function (res) { results = res; };

    beforeEach(function () {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 150 * 1000;
        shell.rm('-rf', tmpDir);
        // Copy then move because we need to copy everything, but that means it will copy the whole directory.
        // Using /* doesn't work because of hidden files.
        shell.cp('-R', path.join(__dirname, '..', 'spec', 'cordova', 'fixtures', 'basePkgJson'), tmpDir);
        shell.mv(path.join(tmpDir, 'basePkgJson'), project);
        process.chdir(project);
        events.on('results', listener);
    });

    afterEach(function () {
        events.removeListener('results', listener);
        cordova_util.requireNoCache(path.join(process.cwd(), 'package.json'));
        process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
        shell.rm('-rf', tmpDir);
    });

    // Factoring out some repeated checks.
    function emptyPlatformList () {
        return cordovaPlatform('list').then(function () {
            var installed = results.match(/Installed platforms:\n {2}(.*)/);
            expect(installed).toBeDefined();
            expect(installed[1].indexOf(helpers.testPlatform)).toBe(-1);
        });
    }

    function fullPlatformList () {
        return cordovaPlatform('list').then(function () {
            var installed = results.match(/Installed platforms:\n {2}(.*)/);
            expect(installed).toBeDefined();
            expect(installed[1].indexOf(helpers.testPlatform)).toBeGreaterThan(-1);
        });
    }

    /** Test#001 will add a platform to package.json with the 'save' flag.
    *   It will remove it from platforms.json without the save flag.
    *   After running cordova prepare, that platform should be restored in the
    *   installed platform list in platforms.json.
    */
    it('Test#001 : should restore platform that has been removed from project', function () {
        var cwd = process.cwd();
        var pkgJsonPath = path.join(cwd, 'package.json');
        cordova_util.requireNoCache(pkgJsonPath);
        var pkgJson;

        return emptyPlatformList().then(function () {
            // Add the testing platform with --save.
            return cordovaPlatform('add', 'android', {'save': true});
        }).then(function () {
            pkgJson = cordova_util.requireNoCache(pkgJsonPath);
            // Check the platform add was successful in package.json.
            expect(pkgJson.cordova.platforms).toBeDefined();
            expect(pkgJson.cordova.platforms.indexOf(helpers.testPlatform)).toBeGreaterThan(-1);
        }).then(fullPlatformList) // Platform should still be in platform ls.
            .then(function () {
                // And now remove helpers.testPlatform without --save.
                return cordovaPlatform('rm', ['browser']);
            }).then(function () {
                // Delete any previous caches of require(package.json) and (platforms.json)
                pkgJson = cordova_util.requireNoCache(pkgJsonPath);
                // Check that the platform removed without --save is still in platforms key.
                expect(pkgJson.cordova.platforms.indexOf(helpers.testPlatform)).toBeGreaterThan(-1);
            }).then(function () {
                // Run cordova prepare.
                return prepare();
            });
    // Cordova prepare needs extra wait time to complete.
    }, TIMEOUT);

    /** Test#002 will add two platforms to package.json with the 'save' flag.
    *   It will remove one platform from pkg.json without the 'save' flag and remove
    *   the other platform with the 'save' flag. After running cordova prepare,
    *   the platform removed with the 'save' flag should NOT be restored in platforms.json.
    */
    it('Test#002 : should NOT restore platform that was removed with --save', function () {
        var cwd = process.cwd();
        var pkgJsonPath = path.join(cwd, 'package.json');
        var pkgJson;
        var secondPlatformAdded = 'browser';

        return emptyPlatformList().then(function () {
            // Add the testing platform with --save.
            return cordovaPlatform('add', [helpers.testPlatform], {'save': true});
        }).then(function () {
            // Add the 'browser' platform with --save
            return cordovaPlatform('add', secondPlatformAdded, {'save': true});
        }).then(function () {
            // Delete any previous caches of require(package.json) and (platforms.json).
            pkgJson = cordova_util.requireNoCache(pkgJsonPath);
            // Check the platform add of both platforms (to pkg.Json) was successful.
            expect(pkgJson.cordova.platforms).toBeDefined();
            expect(pkgJson.cordova.platforms.indexOf(helpers.testPlatform)).toEqual(0);
            expect(pkgJson.cordova.platforms.indexOf(secondPlatformAdded)).toEqual(1);
        }).then(fullPlatformList) // Platform should still be in platform ls.
            .then(function () {
                // Remove helpers.testPlatform with --save.
                return cordovaPlatform('rm', [helpers.testPlatform], {'save': true});
            }).then(function () {
                // Remove secondPlatformAdded without --save.
                return cordovaPlatform('rm', secondPlatformAdded);
            }).then(function () {
                // Delete any previous caches of require(package.json)
                pkgJson = cordova_util.requireNoCache(pkgJsonPath);
                // Check that ONLY the platform removed without --save is still in (pkg.json) platforms key.
                expect(pkgJson.cordova.platforms.indexOf(secondPlatformAdded)).toEqual(0);
                expect(pkgJson.cordova.platforms.indexOf(helpers.testPlatform)).toEqual(-1);
            }).then(function () {
                // Run cordova prepare.
                return prepare();
            });
    // Cordova prepare needs extra wait time to complete.
    }, TIMEOUT);
});
