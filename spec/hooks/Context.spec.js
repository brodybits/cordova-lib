/*!
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

const events = require('cordova-common').events;
const Context = require('../../src/hooks/Context');

describe('hooks/Context', () => {
    describe('requireCordovaModule', () => {
        const requireCordovaModule = Context.prototype.requireCordovaModule;
        let warnSpy;

        beforeEach(() => {
            warnSpy = jasmine.createSpy('warnSpy');
            events.on('warn', warnSpy);
        });

        afterEach(() => {
            events.removeListener('warn', warnSpy);
        });

        it('throws an error (and emits a warning) if non-supported react-native module is requested', () => {
            expect(() => requireCordovaModule('react-native')).toThrowError();
            expect(warnSpy).toHaveBeenCalledWith(
                'Use of requireCordovaModule with non-Cordova module is now deprecated, may be removed in the near future. ' +
                "Recommended solution: run `npm install react-native` & use `require('react-native')`"
            );
        });

        it('emits a warning message if supported non-cordova module is requested', () => {
            requireCordovaModule('semver');
            expect(warnSpy).toHaveBeenCalledWith(
                'Use of requireCordovaModule with non-Cordova module is now deprecated, may be removed in the near future. ' +
                "Recommended solution: run `npm install semver` & use `require('semver')`"
            );
        });
    });
});
