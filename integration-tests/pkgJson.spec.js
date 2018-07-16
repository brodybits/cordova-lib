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
var helpers = require('../spec/helpers');
var path = require('path');
var fs = require('fs-extra');
var events = require('cordova-common').events;
var ConfigParser = require('cordova-common').ConfigParser;
var cordova = require('../src/cordova/cordova');
var cordova_util = require('../src/cordova/util');
var semver = require('semver');

describe('pkgJson', function () {

    const fixturesPath = path.join(__dirname, '../spec/cordova/fixtures');
    var tmpDir, project, results, pkgJsonPath, configXmlPath;

    const TIMEOUT = 150 * 1000;
    helpers.setDefaultTimeout(TIMEOUT);

    afterEach(function () {
        process.chdir(path.join(__dirname, '..')); // Needed to rm the dir on Windows.
        fs.removeSync(tmpDir);
    });

    function setup (name) {
        tmpDir = helpers.tmpDir('pkgJson');
        project = path.join(tmpDir, 'project');
        pkgJsonPath = path.join(project, 'package.json');
        configXmlPath = path.join(project, 'config.xml');

        fs.copySync(path.join(fixturesPath, name), project);
        process.chdir(project);
        delete process.env.PWD;
        events.on('results', function (res) { results = res; });
    }

    // Factoring out some repeated checks.
    function emptyPlatformList () {
        return cordova.platform('list').then(function () {
            var installed = results.match(/Installed platforms:\n {2}(.*)/);
            expect(installed).toBeDefined();
            expect(installed[1].indexOf(helpers.testPlatform)).toBe(-1);
        });
    }

    function includeFunc (container, value) {
        var returnValue = false;
        var pos = container.indexOf(value);
        if (pos >= 0) {
            returnValue = true;
        }
        return returnValue;
    }

    function getPkgJson (propPath) {
        expect(pkgJsonPath).toExist();
        const keys = propPath ? propPath.split('.') : [];
        return keys.reduce((obj, key) => {
            expect(obj).toBeDefined();
            return obj[key];
        }, cordova_util.requireNoCache(pkgJsonPath));
    }

    // This group of tests checks if plugins are added and removed as expected from package.json.
    describe('plugin end-to-end', function () {
        var pluginId = 'cordova-plugin-device';

        beforeEach(function () {
            setup('basePkgJson');
            // Copy some platform to avoid working on a project with no platforms.
            // FIXME Use a fixture that is properly promisified. This one
            // causes spurious test failures when tests reuse the project path.
            fs.copySync(path.join(__dirname, '../spec/plugman/projects', helpers.testPlatform), path.join(project, 'platforms', helpers.testPlatform));
        });

        it('Test#001 : should successfully add and remove a plugin with save and correct spec', function () {
            var cfg = new ConfigParser(configXmlPath);
            var configPlugins = cfg.getPluginIdList();
            var configPlugin = cfg.getPlugin(configPlugins);

            // No plugins in config or pkg.json yet.
            expect(configPlugins.length).toEqual(0);
            expect(getPkgJson('cordova')).toBeUndefined();

            // Add the plugin with --save.
            return cordova.plugin('add', pluginId + '@1.1.2', {'save': true})
                .then(function () {
                    // Check that the plugin and spec add was successful to pkg.json.
                    expect(getPkgJson('cordova.plugins')[pluginId]).toBeDefined();
                    expect(getPkgJson('dependencies')[pluginId]).toEqual('^1.1.2');
                    // Check that the plugin and spec add was successful to config.xml.
                    var cfg2 = new ConfigParser(configXmlPath);
                    configPlugins = cfg2.getPluginIdList();
                    configPlugin = cfg2.getPlugin(configPlugins);
                    expect(configPlugins.length).toEqual(1);
                    expect(configPlugin).toEqual({ name: 'cordova-plugin-device', spec: '^1.1.2', variables: {} });
                }).then(function () {
                    // And now remove it with --save.
                    return cordova.plugin('rm', pluginId, {'save': true});
                }).then(function () {
                    // Expect plugin to be removed from pkg.json.
                    expect(getPkgJson('cordova.plugins')[pluginId]).toBeUndefined();
                    expect(getPkgJson('dependencies')[pluginId]).toBeUndefined();
                });
        });

        it('Test#002 : should NOT add a plugin to package.json if --save is not used', function () {
            expect(pkgJsonPath).toExist();

            // Add the geolocation plugin with --save.
            return cordova.plugin('add', 'cordova-plugin-geolocation', {'save': true})
                .then(function () {
                    // Add a second plugin without save.
                    return cordova.plugin('add', pluginId);
                }).then(function () {
                    // Expect that only the plugin that had --save was added.
                    expect(getPkgJson('cordova.plugins')).toEqual({
                        'cordova-plugin-geolocation': {}
                    });
                });
        });

        it('Test#003 : should NOT remove plugin from package.json if there is no --save', function () {
            expect(pkgJsonPath).toExist();

            // Add the plugin with --save.
            return cordova.plugin('add', pluginId, {'save': true})
                .then(function () {
                    expect(getPkgJson('cordova.plugins')).toEqual({
                        [pluginId]: {}
                    });
                }).then(function () {
                    // And now remove it, but without --save.
                    return cordova.plugin('rm', 'cordova-plugin-device');
                }).then(function () {
                    // The plugin should still be in package.json.
                    expect(getPkgJson('cordova.plugins')).toEqual({
                        [pluginId]: {}
                    });
                });
        });

        it('Test#004 : should successfully add and remove a plugin with variables and save to package.json', function () {
            expect(pkgJsonPath).toExist();

            // Add the plugin with --save.
            return cordova.plugin('add', pluginId, {'save': true, 'cli_variables': {'someKey': 'someValue'}})
                .then(function () {
                    // Check the plugin add was successful and that variables have been added too.
                    expect(getPkgJson('cordova.plugins')).toEqual({
                        [pluginId]: {someKey: 'someValue'}
                    });
                }).then(function () {
                    // And now remove it with --save.
                    return cordova.plugin('rm', pluginId, {'save': true});
                }).then(function () {
                    // Checking that the plugin and variables were removed successfully.
                    expect(getPkgJson('cordova.plugins')).toEqual({});
                });
        });

        // CB-12170 : Test is commented out because not promisified correctly in cordova-create script
        xit('Test#005 : should successfully add and remove multiple plugins with save & fetch', function () {
            expect(pkgJsonPath).toExist();

            // Add the plugin with --save.
            return cordova.plugin('add', [pluginId, 'cordova-plugin-device-motion'], {'save': true})
                .then(function () {
                    // Check that the plugin add was successful.
                    expect(getPkgJson('cordova.plugins')).toEqual({
                        [pluginId]: {},
                        'cordova-plugin-device-motion': {}
                    });
                    expect(getPkgJson('dependencies')).toEqual({
                        [pluginId]: jasmine.any(String),
                        'cordova-plugin-device-motion': jasmine.any(String)
                    });
                }).then(function () {
                    // And now remove it with --save.
                    return cordova.plugin('rm', [pluginId, 'cordova-plugin-device-motion'], {'save': true});
                }).then(function () {
                    // Checking that the plugin removed is in not in the platforms.
                    expect(getPkgJson('cordova.plugins')).toEqual({});
                    expect(getPkgJson('dependencies')).toEqual({});
                });
        });

        // Test #023 : if pkg.json and config.xml have no platforms/plugins/spec.
        // and --save --fetch is called, use the pinned version or plugin pkg.json version.
        it('Test#023 : use pinned/lastest version if there is no platform/plugin version passed in and no platform/plugin versions in pkg.json or config.xml', function () {
            var iosPlatform = 'ios';
            var iosVersion;
            var iosDirectory = path.join(project, 'platforms/ios/cordova/version');
            var iosJsonPath = path.join(project, 'platforms/ios/ios.json');
            var cfg = new ConfigParser(configXmlPath);
            var engines = cfg.getEngines();
            var engNames; // eslint-disable-line no-unused-vars
            var engSpec; // eslint-disable-line no-unused-vars
            var configPlugins = cfg.getPluginIdList();
            var configPlugin = cfg.getPlugin(configPlugins);
            var pluginPkgJsonDir = path.join(project, 'plugins/cordova-plugin-geolocation/package.json');
            var pluginPkgJsonVersion;

            // Pkg.json has no platform or plugin or specs.
            expect(getPkgJson('cordova')).toBeUndefined();
            expect(getPkgJson('dependencies')).toBeUndefined();
            // Config.xml has no platform or plugin or specs.
            expect(engines.length).toEqual(0);
            // Add ios without version.
            return cordova.platform('add', ['ios'], {'save': true})
                .then(function () {
                    // Pkg.json has ios.
                    expect(getPkgJson('cordova.platforms')).toEqual([iosPlatform]);
                    // Config.xml and ios/cordova/version check.
                    var cfg2 = new ConfigParser(configXmlPath);
                    engines = cfg2.getEngines();
                    // ios platform has been added to config.xml.
                    expect(engines.length).toEqual(1);
                    // Config.xml has ios platform.
                    engNames = engines.map(function (elem) {
                        return elem.name;
                    });
                    expect(engNames).toEqual([ 'ios' ]);
                    // delete previous caches of iosVersion;
                    iosVersion = cordova_util.requireNoCache(iosDirectory);
                    engSpec = engines.map(function (elem) {
                        // Check that config and ios/cordova/version versions "satify" each other.
                        expect(semver.satisfies(iosVersion.version, elem.spec)).toEqual(true);
                    });
                }).then(function () {
                    // Add geolocation plugin with --save --fetch.
                    return cordova.plugin('add', 'cordova-plugin-geolocation', {'save': true});
                }).then(function () {
                    var iosJson = cordova_util.requireNoCache(iosJsonPath);
                    expect(iosJson.installed_plugins['cordova-plugin-geolocation']).toBeDefined();
                    var cfg3 = new ConfigParser(configXmlPath);
                    // Check config.xml for plugins and spec.
                    configPlugins = cfg3.getPluginIdList();
                    configPlugin = cfg3.getPlugin(configPlugins);
                    // Delete previous caches of pluginPkgJson.
                    pluginPkgJsonVersion = cordova_util.requireNoCache(pluginPkgJsonDir);
                    // Check that version in plugin pkg.json and config version "satisfy" each other.
                    expect(semver.satisfies(pluginPkgJsonVersion.version, configPlugin.spec)).toEqual(true);
                    // Check that pkg.json and plugin pkg.json versions "satisfy".
                    expect(semver.satisfies(pluginPkgJsonVersion.version, getPkgJson('dependencies.cordova-ios')));
                });
        });

        // Test#025: has a pkg.json. Checks if local path is added to pkg.json for platform and plugin add.
        it('Test#025 : if you add a platform/plugin with local path, pkg.json gets updated', function () {

            var platformPath = path.join(fixturesPath, 'platforms/cordova-browser');
            var pluginPath = path.join(fixturesPath, 'plugins/cordova-lib-test-plugin');
            var cfg = new ConfigParser(configXmlPath);
            var engines = cfg.getEngines();
            var engNames; // eslint-disable-line no-unused-vars
            var engSpec; // eslint-disable-line no-unused-vars

            // Run cordova platform add local path --save --fetch.
            return cordova.platform('add', platformPath, {'save': true})
                .then(function () {
                    // Pkg.json has browser.
                    expect(getPkgJson('cordova.platforms')).toEqual(['browser']);
                    expect(getPkgJson('dependencies.cordova-browser')).toBeDefined();

                    var cfg2 = new ConfigParser(configXmlPath);
                    engines = cfg2.getEngines();
                    // browser platform and spec have been added to config.xml.
                    engNames = engines.map(function (elem) {
                        return elem.name;
                    });
                    engSpec = engines.map(function (elem) {
                        if (elem.name === 'browser') {
                            var result = includeFunc(elem.spec, platformPath);
                            expect(result).toEqual(true);
                        }
                    });
                }).then(function () {
                    // Run cordova plugin add local path --save --fetch.
                    return cordova.plugin('add', pluginPath, {'save': true});
                }).then(function () {
                    // Pkg.json has test plugin.
                    expect(getPkgJson('cordova.plugins.cordova-lib-test-plugin')).toBeDefined();
                    expect(getPkgJson('dependencies.cordova-lib-test-plugin')).toBeDefined();

                    var cfg3 = new ConfigParser(configXmlPath);
                    engines = cfg3.getEngines();
                    // Check that browser and spec have been added to config.xml
                    engNames = engines.map(function (elem) {
                        return elem.name;
                    });
                    engSpec = engines.map(function (elem) {
                        if (elem.name === 'browser') {
                            var result = includeFunc(elem.spec, platformPath);
                            expect(result).toEqual(true);
                        }
                    });
                });
        });
    });

    // This group of tests checks if platforms are added and removed as expected from package.json.
    describe('platform end-to-end with --save', function () {
        beforeEach(() => setup('basePkgJson'));

        function fullPlatformList () {
            return cordova.platform('list').then(function () {
                var installed = results.match(/Installed platforms:\n {2}(.*)/);
                expect(installed).toBeDefined();
                expect(installed[1].indexOf(helpers.testPlatform)).toBeGreaterThan(-1);
            });
        }

        it('Test#006 : platform is added and removed correctly with --save', function () {
            expect(pkgJsonPath).toExist();

            // Check there are no platforms yet.
            return emptyPlatformList().then(function () {
                // Add the testing platform with --save.
                return cordova.platform('add', [helpers.testPlatform], {'save': true});
            }).then(function () {
                // Check the platform add was successful.
                expect(getPkgJson('cordova.platforms')).toEqual([helpers.testPlatform]);
            }).then(function () {
                return fullPlatformList();
            }).then(function () {
                // And now remove it with --save.
                return cordova.platform('rm', [helpers.testPlatform], {'save': true});
            }).then(function () {
                // Checking that the platform removed is in not in the platforms key.
                expect(getPkgJson('cordova.platforms')).toEqual([]);
            });
        });

        it('Test#007 : should not remove platforms from package.json when removing without --save', function () {
            expect(pkgJsonPath).toExist();

            return emptyPlatformList().then(function () {
                // Add the testing platform with --save.
                return cordova.platform('add', [helpers.testPlatform], {'save': true});
            }).then(function () {
                // Check the platform add was successful.
                expect(getPkgJson('cordova.platforms')).toEqual([helpers.testPlatform]);
            }).then(function () {
                return fullPlatformList();
            }).then(function () {
                // And now remove it without --save.
                return cordova.platform('rm', [helpers.testPlatform]);
            }).then(function () {
                // Check that the platform removed without --save is still in platforms key.
                expect(getPkgJson('cordova.platforms')).toEqual([helpers.testPlatform]);
            }).then(function () {
                return emptyPlatformList();
            });
        });

        it('Test#008 : should not add platform to package.json when adding without --save', function () {
            expect(pkgJsonPath).toExist();
            // Pkg.json "platforms" should be empty and helpers.testPlatform should not exist in pkg.json.
            expect(getPkgJson('cordova')).toBeUndefined();

            // Add platform without --save.
            return cordova.platform('add', [helpers.testPlatform])
                .then(function () {
                    // PkgJson.cordova should not be defined and helpers.testPlatform should NOT have been added.
                    expect(getPkgJson('cordova')).toBeUndefined();
                }).then(function () {
                    return fullPlatformList();
                });
        });

        it('Test#009 : should only add the platform to package.json with --save', function () {
            var platformNotToAdd = 'browser';
            expect(pkgJsonPath).toExist();

            // Add a platform without --save.
            return cordova.platform('add', platformNotToAdd)
                .then(function () {
                    // And now add another platform with --save.
                    return cordova.platform('add', [helpers.testPlatform], {'save': true});
                }).then(function () {
                    // Check that only the platform added with --save was added to package.json.
                    expect(getPkgJson('cordova.platforms')).toEqual([helpers.testPlatform]);
                });
        });

        it('Test#010 : two platforms are added and removed correctly with --save --fetch', function () {
            var cfg = new ConfigParser(configXmlPath);
            var engines = cfg.getEngines();
            var engNames = engines.map(function (elem) {
                return elem.name;
            });
            var configEngArray = engNames.slice();

            // No platforms in config or pkg.json yet.
            expect(getPkgJson('cordova')).toBeUndefined();
            expect(configEngArray.length === 0);
            // Check there are no platforms yet.
            return emptyPlatformList().then(function () {
                // Add the testing platform with --save and add specific version to android platform.
                return cordova.platform('add', ['android@7.0.0', 'browser@5.0.1'], {'save': true});
            }).then(function () {
                // Check the platform add was successful in platforms list and
                // dependencies should have specific version from add.
                expect(getPkgJson('cordova.platforms')).toEqual(['android', 'browser']);
                expect(getPkgJson('dependencies')).toEqual({
                    'cordova-android': '^7.0.0',
                    'cordova-browser': '^5.0.1'
                });

                var cfg3 = new ConfigParser(configXmlPath);
                engines = cfg3.getEngines();
                engNames = engines.map(function (elem) {
                    return elem.name;
                });
                configEngArray = engNames.slice();
                // Check that android and browser were added to config.xml with the correct spec.
                expect(configEngArray.length === 2);
                expect(engines).toEqual([ { name: 'android', spec: '~7.0.0' }, { name: 'browser', spec: '~5.0.1' } ]);
            }).then(function () {
                return fullPlatformList();
            }).then(function () {
                // And now remove it with --save.
                return cordova.platform('rm', ['android', 'browser'], {'save': true});
            }).then(function () {
                // Expect platforms to be removed frpm package.json
                expect(getPkgJson('cordova.platforms')).toEqual([]);
                expect(getPkgJson('dependencies')).toEqual({});
                // Platforms are removed from config.xml.
                var cfg4 = new ConfigParser(configXmlPath);
                engines = cfg4.getEngines();
                engNames = engines.map(function (elem) {
                    return elem.name;
                });
                configEngArray = engNames.slice();
                // Platforms are removed from config.xml.
                expect(configEngArray.length === 0);
            }).then(function () {
                return emptyPlatformList();
            });
        });
    });

    // Test #020 : use basePkgJson15 as pkg.json contains platform/spec and plugin/spec and config.xml does not.
    describe('During add, if pkg.json has a platform/plugin spec, use that one.', function () {
        beforeEach(() => setup('basePkgJson15'));

        /** Test#020 will check that pkg.json, config.xml, platforms.json, and cordova platform ls
        *   are updated with the correct (platform and plugin) specs from pkg.json.
        */
        it('Test#020 : During add, if pkg.json has a spec, use that one.', function () {
            var iosPlatform = 'ios';
            var iosVersion;
            var iosDirectory = path.join(project, 'platforms/ios/cordova/version');
            var cfg = new ConfigParser(configXmlPath);
            var engines = cfg.getEngines();
            var engNames;
            var engSpec; // eslint-disable-line no-unused-vars
            var configPlugins = cfg.getPluginIdList();
            var pluginPkgJsonDir = path.join(project, 'plugins/cordova-plugin-splashscreen/package.json');
            var pluginPkgJsonVersion;

            // Pkg.json has ios and spec '^4.2.1' and splashscreen '^3.2.2'.
            expect(getPkgJson('cordova.platforms')).toEqual([ iosPlatform ]);
            expect(getPkgJson('dependencies')).toEqual({
                'cordova-plugin-splashscreen': '^3.2.2',
                'cordova-ios': '^4.5.4'
            });
            // Config.xml has no platforms or plugins yet.
            expect(engines.length).toEqual(0);
            expect(configPlugins.length).toEqual(0);

            return emptyPlatformList().then(function () {
                // Add ios with --save and --fetch.
                return cordova.platform('add', [iosPlatform], {'save': true});
            }).then(function () {
                // No change to pkg.json platforms or spec for ios.
                expect(getPkgJson('cordova.platforms')).toEqual([iosPlatform]);
                // Config.xml and ios/cordova/version check.
                var cfg2 = new ConfigParser(configXmlPath);
                engines = cfg2.getEngines();
                // ios platform has been added to config.xml.
                expect(engines.length).toEqual(1);
                engNames = engines.map(function (elem) {
                    // ios is added to config
                    expect(elem.name).toEqual(iosPlatform);
                    return elem.name;
                });
                engSpec = engines.map(function (elem) {
                    // Check that config and ios/cordova/version versions "satify" each other.
                    iosVersion = cordova_util.requireNoCache(iosDirectory);
                    expect(semver.satisfies(iosVersion.version, elem.spec)).toEqual(true);
                });
                // Config.xml added ios platform.
                expect(engNames).toEqual([ 'ios' ]);
                // Check that pkg.json and ios/cordova/version versions "satisfy" each other.
                expect(semver.satisfies(iosVersion.version, getPkgJson('dependencies.cordova-ios'))).toEqual(true);
            }).then(function () {
                // Add splashscreen plugin with --save --fetch.
                return cordova.plugin('add', 'cordova-plugin-splashscreen', {'save': true});
            }).then(function () {
                pluginPkgJsonVersion = cordova_util.requireNoCache(pluginPkgJsonDir);
                // Check that pkg.json version and plugin pkg.json version "satisfy" each other.
                expect(semver.satisfies(pluginPkgJsonVersion.version, getPkgJson('dependencies.cordova-plugin-splashscreen'))).toEqual(true);
            });
        }, TIMEOUT * 2);
    });

    // Test #021 : use basePkgJson16 as config.xml contains platform/spec and plugin/spec pkg.json does not.
    describe('During add, if config.xml has a platform/plugin spec and pkg.json does not, use config.', function () {
        beforeEach(() => setup('basePkgJson16'));

        /** Test#021 during add, this test will check that pkg.json, config.xml, platforms.json,
        *   and cordova platform ls are updated with the correct platform/plugin spec from config.xml.
        */
        it('Test#021 : If config.xml has a spec (and none was specified and pkg.json does not have one), use config.', function () {
            var iosPlatform = 'ios';
            var iosVersion;
            var iosDirectory = path.join(project, 'platforms/ios/cordova/version');
            var cfg = new ConfigParser(configXmlPath);
            var engines = cfg.getEngines();
            var engNames;
            var engSpec; // eslint-disable-line no-unused-vars
            var configPlugins = cfg.getPluginIdList();
            var configPlugin = cfg.getPlugin(configPlugins);
            var pluginPkgJsonDir = path.join(project, 'plugins/cordova-plugin-splashscreen/package.json');
            var pluginPkgJsonVersion;

            // Pkg.json does not have platform or spec yet. Config.xml has ios and spec '~4.2.1'.
            return emptyPlatformList().then(function () {
                // Remove for testing purposes so platform is not pre-installed.
                cordova.platform('rm', [iosPlatform], {'save': true});
            }).then(function () {
                // Add ios with --save and --fetch.
                return cordova.platform('add', [iosPlatform], {'save': true});
            }).then(function () {
                // pkg.json has new platform.
                expect(getPkgJson('cordova.platforms')).toEqual([iosPlatform]);
                // Config.xml and ios/cordova/version check.
                var cfg2 = new ConfigParser(configXmlPath);
                engines = cfg2.getEngines();
                // ios platform is in config.xml.
                expect(engines.length).toEqual(1);
                engNames = engines.map(function (elem) {
                    return elem.name;
                });
                // Config.xml has ios platform.
                expect(engNames).toEqual([ 'ios' ]);
                engSpec = engines.map(function (elem) {
                    iosVersion = cordova_util.requireNoCache(iosDirectory);
                    // Config and ios/cordova/version versions "satisfy" each other.
                    expect(semver.satisfies(iosVersion.version, elem.spec)).toEqual(true);
                });
            }).then(function () {
                // Add splashscreen with --save --fetch.
                return cordova.plugin('add', 'cordova-plugin-splashscreen', {'save': true});
            }).then(function () {
                var cfg3 = new ConfigParser(configXmlPath);
                // Check config.xml for plugins and spec.
                configPlugins = cfg3.getPluginIdList();
                configPlugin = cfg3.getPlugin(configPlugins);
                expect(configPlugins.length).toEqual(1);
                // Splashscreen plugin and spec added.
                expect(configPlugin.name).toEqual('cordova-plugin-splashscreen');
                pluginPkgJsonVersion = cordova_util.requireNoCache(pluginPkgJsonDir);
                // Check that version in plugin pkg.json and config version "satisfy" each other.
                expect(semver.satisfies(pluginPkgJsonVersion.version, configPlugin.spec)).toEqual(true);
            });
        });
    });

    // Test #022 : use basePkgJson17 (config.xml and pkg.json each have ios platform with different specs).
    describe('During add, if add specifies a platform spec, use that one regardless of what is in pkg.json or config.xml', function () {
        beforeEach(() => setup('basePkgJson17'));

        /** Test#022 : when adding with a specific platform version, always use that one
        *   regardless of what is in package.json or config.xml.
        */
        it('Test#022 : when adding with a specific platform version, always use that one.', function () {
            var iosPlatform = 'ios';
            var iosVersion;
            var iosDirectory = path.join(project, 'platforms/ios/cordova/version');
            var cfg = new ConfigParser(configXmlPath);
            var engines = cfg.getEngines();
            var engNames;
            var configPlugins = cfg.getPluginIdList();
            var configPlugin = cfg.getPlugin(configPlugins);
            var pluginPkgJsonDir = path.join(project, 'plugins/cordova-plugin-splashscreen/package.json');
            var pluginPkgJsonVersion;

            // Pkg.json has ios and spec '^4.2.1'.
            expect(getPkgJson('cordova.platforms')).toEqual([ iosPlatform ]);
            expect(getPkgJson('dependencies')).toEqual({
                'cordova-ios': '^4.2.1',
                'cordova-plugin-splashscreen': '~3.2.2'
            });
            // Config.xml has ios and spec ~4.2.1.
            expect(engines.length).toEqual(1);
            expect(engines).toEqual([ { name: 'ios', spec: '~4.2.1' } ]);
            return emptyPlatformList().then(function () {
                // Add ios with --save and --fetch.
                return cordova.platform('add', ['ios@4.5.4'], {'save': true});
            }).then(function () {
                // Pkg.json has ios.
                expect(getPkgJson('cordova.platforms')).toEqual([iosPlatform]);
                // Config.xml and ios/cordova/version check.
                var cfg2 = new ConfigParser(configXmlPath);
                engines = cfg2.getEngines();
                // ios platform has been added to config.xml.
                expect(engines.length).toEqual(1);
                engNames = engines.map(function (elem) {
                    return elem.name;
                });
                // Config.xml has ios platform.
                expect(engNames).toEqual([ 'ios' ]);
                // delete previous caches of iosVersion;
                iosVersion = cordova_util.requireNoCache(iosDirectory);
                // Check that pkg.json and ios/cordova/version versions "satisfy" each other.
                expect(semver.satisfies(iosVersion.version, getPkgJson('dependencies.cordova-ios'))).toEqual(true);
            }).then(function () {
                // Add splashscreen with --save --fetch.
                return cordova.plugin('add', 'cordova-plugin-splashscreen@4.0.0', {'save': true});
            }).then(function () {
                var cfg3 = new ConfigParser(configXmlPath);
                // Check config.xml for plugins and spec.
                configPlugins = cfg3.getPluginIdList();

                configPlugin = cfg3.getPlugin(configPlugins);
                // Delete previous caches of pluginPkgJson.
                pluginPkgJsonVersion = cordova_util.requireNoCache(pluginPkgJsonDir);
                // Check that version in plugin pkg.json and config version "satisfy" each other.
                expect(semver.satisfies(pluginPkgJsonVersion.version, configPlugin.spec)).toEqual(true);
                // Check that pkg.json and plugin pkg.json versions "satisfy".
                expect(semver.satisfies(pluginPkgJsonVersion.version, getPkgJson('dependencies.cordova-ios')));
            });
        });
    });

    // No pkg.json included in test file.
    describe('local path is added to config.xml without pkg.json', function () {
        beforeEach(() => setup('basePkgJson13'));

        // Test#026: has NO pkg.json. Checks if local path is added to config.xml and has no errors.
        it('Test#026 : if you add a platform with local path, config.xml gets updated', function () {
            var cfg = new ConfigParser(configXmlPath);
            var engines = cfg.getEngines();
            var engNames; // eslint-disable-line no-unused-vars
            var engSpec; // eslint-disable-line no-unused-vars
            var platformPath = path.join(fixturesPath, 'platforms/cordova-browser');

            // Run cordova platform add local path --save --fetch.
            return cordova.platform('add', platformPath, {'save': true})
                .then(function () {
                    var cfg2 = new ConfigParser(configXmlPath);
                    engines = cfg2.getEngines();
                    // ios platform and spec have been added to config.xml.
                    engNames = engines.map(function (elem) {
                        return elem.name;
                    });
                    engSpec = engines.map(function (elem) {
                        if (elem.name === 'browser') {
                            var result = includeFunc(elem.spec, platformPath);
                            expect(result).toEqual(true);
                        }
                    });
                });
        });

        // Test#027: has NO pkg.json. Checks if local path is added to config.xml and has no errors.
        it('Test#027 : if you add a plugin with local path, config.xml gets updated', function () {
            var pluginPath = path.join(fixturesPath, 'plugins/cordova-lib-test-plugin');
            var cfg = new ConfigParser(configXmlPath);
            var configPlugins = cfg.getPluginIdList();
            var configPlugin = cfg.getPlugin(configPlugins);
            // Run platform add with local path.
            return cordova.plugin('add', pluginPath, {'save': true})
                .then(function () {
                    var cfg2 = new ConfigParser(configXmlPath);
                    // Check config.xml for plugins and spec.
                    configPlugins = cfg2.getPluginIdList();
                    configPlugin = cfg2.getPlugin(configPlugins[1]);
                    // Plugin is added.
                    expect(configPlugin.name).toEqual('cordova-lib-test-plugin');
                    // Spec for geolocation plugin is added.
                    var result = includeFunc(configPlugin.spec, pluginPath);
                    expect(result).toEqual(true);
                });
        });
    });
});
