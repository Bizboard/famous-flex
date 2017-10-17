/**
 * This Source Code is licensed under the MIT license. If a copy of the
 * MIT-license was not distributed with this file, You can obtain one at:
 * http://opensource.org/licenses/mit-license.html.
 *
 * @author: Hein Rutjes (IjzerenHein)
 * @license MIT
 * @copyright Gloey Apps, 2014 - 2015
 */

/**
 * Internal LayoutNode class used by `LayoutNodeManager`.
 *
 * @module
 */
define(function (require, exports, module) {

    // import dependencies
    var OptionsManager = require('arva-js/famous/core/OptionsManager');
    var Transform = require('arva-js/famous/core/Transform');
    var Engine = require('arva-js/famous/core/Engine');
    var Vector = require('arva-js/famous/math/Vector');
    var Particle = require('arva-js/famous/physics/bodies/Particle');
    var Spring = require('arva-js/famous/physics/forces/Spring');
    var PhysicsEngine = require('arva-js/famous/physics/PhysicsEngine');
    var LayoutNode = require('./LayoutNode');
    var Transitionable = require('arva-js/famous/transitions/Transitionable');
    var Easing = require('arva-js/famous/transitions/Easing');

    /**
     * @class
     * @extends LayoutNode
     * @param {Object} renderNode Render-node which this layout-node represents
     * @param {Spec} spec Initial state
     * @param {Object} physicsEngines physics-engines to use
     * @alias module:FlowLayoutNode
     */
    function FlowLayoutNode(renderNode, spec) {

        LayoutNode.apply(this, arguments);

        /* Recreating the objects because constructor can be called twice */

        if (!this.options) {
            this.options = Object.create(this.constructor.DEFAULT_OPTIONS);
            this._optionsManager = new OptionsManager(this.options);
        }

        if (!this._pe) {
            this._pe = new PhysicsEngine();
            this._pe.on('end', function () {
                if (!this._shouldDoSingleTween) {
                    this._completeFlowCallback({ reason: 'flowEnd' });
                }
            }.bind(this));
            this._pe.sleep();
        }

        if (!this._properties) {
            this._properties = {};
        }
        else {
            for (var propName in this._properties) {
                this._properties[propName].init = false;
            }
        }

        if (!this._lockTransitionable) {
            this._lockTransitionable = new Transitionable(1);
        }
        else {
            this._lockTransitionable.halt();
            this._lockTransitionable.reset(1);
        }
        this._specModified = true;

        if (spec) {
            this.setInsertSpec(spec);
        }
        this._initial = true;
        this._spec.endState = {};

        /* Assume non-existance by default */
        this._exists = false;
    }

    FlowLayoutNode.prototype = Object.create(LayoutNode.prototype);
    FlowLayoutNode.prototype.constructor = FlowLayoutNode;

    FlowLayoutNode.DEFAULT_OPTIONS = {
        spring: {
            dampingRatio: 0.8,
            period: 300
        },
        properties: {
            opacity: true,
            align: true,
            origin: true,
            size: true,
            translate: true,
            skew: true,
            rotate: true,
            scale: true
        },
        particleRounding: 0.001
    };

    /**
     * Defaults
     */
    var DEFAULT = {
        opacity: 1,
        opacity2D: [1, 0],
        size: [0, 0],
        origin: [0, 0],
        align: [0, 0],
        scale: [1, 1, 1],
        translate: [0, 0, 0],
        rotate: [0, 0, 0],
        skew: [0, 0, 0]
    };
    /**
     * Sets the configuration options
     */
    FlowLayoutNode.prototype.setOptions = function (options) {
        this._optionsManager.setOptions(options);
        var wasSleeping = this._pe.isSleeping();
        for (var propName in this._properties) {
            var prop = this._properties[propName];
            if (options.spring && prop.force) {
                prop.force.setOptions(this.options.spring);
            }
            if (options.properties && (options.properties[propName] !== undefined)) {
                if (this.options.properties[propName].length) {
                    prop.enabled = this.options.properties[propName];
                }
                else {
                    prop.enabled = [
                        this.options.properties[propName],
                        this.options.properties[propName],
                        this.options.properties[propName]
                    ];
                }
            }
        }
        if (wasSleeping) {
            this._pe.sleep();
        }
        return this;
    };

    /**
     * Set the properties from a spec.
     */
    FlowLayoutNode.prototype.setInsertSpec = function (spec) {
        this._latentInsertSpec = spec;
    };

    /**
     * Set the properties from a spec.
     */
    FlowLayoutNode.prototype.executeInsertSpec = function () {
        this._insertSpec = this._latentInsertSpec;
    };

    /**
     * Reset the end-state. This function is called on all layout-nodes prior to
     * calling the layout-function. So that the layout-function starts with a clean slate.
     */
    FlowLayoutNode.prototype.reset = function () {
        if (this._invalidated) {
            for (var propName in this._properties) {
                this._properties[propName].invalidated = false;
            }
            this._invalidated = false;
        }
        this.trueSizeRequested = false;
        this.usesTrueSize = false;
    };

    /**
     * Markes the node for removal.
     */
    FlowLayoutNode.prototype.remove = function (removeSpec) {

        // Transition to the remove-spec state
        this._removing = true;
        if (removeSpec) {
            this.setInsertSpec(removeSpec);
        }
        else {
            this._pe.sleep();
            this._specModified = false;
        }

        // Mark for removal
        this._invalidated = false;
    };

    /**
     * Temporarily releases the flowing-lock that is applied to the node.
     * E.g., when changing position, resizing, the lock should be released so that
     * the renderables can smoothly transition to their new positions.
     */
    FlowLayoutNode.prototype.releaseLock = function (enable, options, callback) {
        if (!this._singleTween) {
            if (!options) {
                options = {
                    duration: this.options.spring.period || 1000
                }
            }
            this._releaseLock = { enable: enable, options: options, callback: callback };
        }

    };

    /**
     * Helper function for getting the property value.
     */
    function _getRoundedValue3D(prop, def, precision, lockValue) {
        if (!prop || !prop.init) {
            return def;
        }
        return [
            prop.enabled[0] ? (Math.round((prop.curState.x + ((prop.endState.x - prop.curState.x) * lockValue)) / precision) * precision) : prop.endState.x,
            prop.enabled[1] ? (Math.round((prop.curState.y + ((prop.endState.y - prop.curState.y) * lockValue)) / precision) * precision) : prop.endState.y,
            prop.enabled[2] ? (Math.round((prop.curState.z + ((prop.endState.z - prop.curState.z) * lockValue)) / precision) * precision) : prop.endState.z
        ];
    }

    FlowLayoutNode.prototype.getTranslate = function () {
        var translate =this._properties.translate.endState;
        return [translate.x, translate.y, translate.z];
    };

    /**
     * Creates the render-spec
     */
    FlowLayoutNode.prototype.getSpec = function () {

        if (this._releaseLock) {
            var enable = this._releaseLock.enable;
            var options = this._releaseLock.options;
            var callback = this._releaseLock.callback;
            this._lockTransitionable.halt();
            this._lockTransitionable.reset(0);
            if (enable) {
                this._lockTransitionable.set(1, options, callback);
            }
            this._releaseLock = undefined;

        }


        if (this._insertSpec) {
            var insertSpec = this._insertSpec;
            this._insertSpec = undefined;
            var oldExists = this._exists;
            var oldRemoving = this._removing;
            var oldInvalidated = this._invalidated;
            this.set(insertSpec);
            this._exists = oldExists;
            this._removing = oldRemoving;
            this._invalidated = oldInvalidated;
        }

        if (!this._exists) {
            this._spec.removed = true;
            return this._spec;
        }

        // When the end state was reached, return the previous spec
        var endStateReached = this._pe.isSleeping() && !this._singleTween;
        if (!this._specModified && endStateReached) {
            this._spec.removed = !this._invalidated;
            return this._spec;
        }
        var lockValue = this._lockTransitionable.get();
        this._lastObservedLockValue = lockValue;
        this._initial = false;
        this._specModified = !endStateReached || this._lockTransitionable.isActive();
        this._spec.removed = false;

        // Step physics engine when not sleeping
        if (!endStateReached && !this._singleTween) {
            this._pe.step();
        }

        // Build fresh spec
        var spec = this._spec;
        var precision = this.options.particleRounding;


        // opacity
        var prop = this._properties.opacity;
        if (prop && prop.init) {
            if (!Engine.shouldPropertyAnimate('opacity')) {
                prop.noAnimation = true;
                prop.curState.x = prop.endState.x;
            }

            if (prop.noAnimation) {
                spec.opacity = prop.endState.x;
            } else {
                spec.opacity = prop.enabled[0] ? Math.max(0, Math.min(1, (Math.round((prop.curState.x + ((prop.endState.x - prop.curState.x) * lockValue)) / precision) * precision))) : prop.endState.x;
                spec.endState.opacity = prop.endState.x;
            }
        }
        else {
            spec.opacity = undefined;
            spec.endState.opacity = undefined;
        }

        // size
        prop = this._properties.size;
        if (prop && prop.init) {

            if (!Engine.shouldPropertyAnimate('size')) {
                prop.noAnimation = true;
                prop.curState.x = prop.endState.x;
                prop.curState.y = prop.endState.y;
            }

            if (prop.noAnimation) {
                spec.size = [prop.endState.x, prop.endState.y] || [0, 0];
            } else {
                spec.size = spec.size || [0, 0];
                spec.size[0] = prop.enabled[0] ? (Math.round((prop.curState.x + ((prop.endState.x - prop.curState.x) * lockValue)) / 0.1) * 0.1) : prop.endState.x;
                spec.size[1] = prop.enabled[1] ? (Math.round((prop.curState.y + ((prop.endState.y - prop.curState.y) * lockValue)) / 0.1) * 0.1) : prop.endState.y;

                spec.endState.size = spec.endState.size || [0, 0];
                spec.endState.size[0] = prop.endState.x;
                spec.endState.size[1] = prop.endState.y;
            }

        }
        else {
            spec.size = undefined;
            spec.endState.size = undefined;
        }

        // align
        prop = this._properties.align;
        if (prop && prop.init) {
            spec.align = spec.align || [0, 0];
            spec.align[0] = prop.enabled[0] ? (Math.round((prop.curState.x + ((prop.endState.x - prop.curState.x) * lockValue)) / 0.0001) * 0.0001) : prop.endState.x;
            spec.align[1] = prop.enabled[1] ? (Math.round((prop.curState.y + ((prop.endState.y - prop.curState.y) * lockValue)) / 0.0001) * 0.0001) : prop.endState.y;
            spec.endState.align = spec.endState.align || [0, 0];
            spec.endState.align[0] = prop.endState.x;
            spec.endState.align[1] = prop.endState.y;
        }
        else {
            spec.align = undefined;
            spec.endState.align = undefined;
        }

        // origin
        prop = this._properties.origin;
        if (prop && prop.init) {
            spec.origin = spec.origin || [0, 0];
            spec.origin[0] = prop.enabled[0] ? (Math.round((prop.curState.x + ((prop.endState.x - prop.curState.x) * lockValue)) / 0.0001) * 0.0001) : prop.endState.x;
            spec.origin[1] = prop.enabled[1] ? (Math.round((prop.curState.y + ((prop.endState.y - prop.curState.y) * lockValue)) / 0.0001) * 0.0001) : prop.endState.y;
            spec.endState.origin = spec.endState.origin || [0, 0];
            spec.endState.origin[0] = prop.endState.x;
            spec.endState.origin[1] = prop.endState.y;
        }
        else {
            spec.origin = undefined;
            spec.endState.origin = undefined;
        }

        // translate
        var translate = this._properties.translate;
        var translateX;
        var translateY;
        var translateZ;
        if (translate && translate.init) {
            translateX = translate.enabled[0] ? (Math.round((translate.curState.x + ((translate.endState.x - translate.curState.x) * lockValue)) / precision) * precision) : translate.endState.x;
            translateY = translate.enabled[1] ? (Math.round((translate.curState.y + ((translate.endState.y - translate.curState.y) * lockValue)) / precision) * precision) : translate.endState.y;
            translateZ = translate.enabled[2] ? (Math.round((translate.curState.z + ((translate.endState.z - translate.curState.z) * lockValue)) / precision) * precision) : translate.endState.z;
        }
        else {
            translateX = 0;
            translateY = 0;
            translateZ = 0;
        }

        // scale, skew, scale
        var scale = this._properties.scale;
        var skew = this._properties.skew;
        var rotate = this._properties.rotate;
        if (scale || skew || rotate) {
            spec.transform = Transform.build({
                translate: [translateX, translateY, translateZ],
                skew: _getRoundedValue3D.call(this, skew, DEFAULT.skew, this.options.particleRounding, lockValue),
                scale: _getRoundedValue3D.call(this, scale, DEFAULT.scale, this.options.particleRounding, lockValue),
                rotate: _getRoundedValue3D.call(this, rotate, DEFAULT.rotate, this.options.particleRounding, lockValue)
            });
            spec.endState.transform = Transform.build({
                translate: translate ? [translate.endState.x, translate.endState.y, translate.endState.z] : DEFAULT.translate,
                scale: scale ? [scale.endState.x, scale.endState.y, scale.endState.z] : DEFAULT.scale,
                skew: skew ? [skew.endState.x, skew.endState.y, skew.endState.z] : DEFAULT.skew,
                rotate: rotate ? [rotate.endState.x, rotate.endState.y, rotate.endState.z] : DEFAULT.rotate
            });
        }
        else if (translate) {
            if (!spec.transform) {
                spec.transform = Transform.translate(translateX, translateY, translateZ);
            }
            else {
                spec.transform[12] = translateX;
                spec.transform[13] = translateY;
                spec.transform[14] = translateZ;
            }
            if (!spec.endState.transform) {
                spec.endState.transform = Transform.translate(translate.endState.x, translate.endState.y, translate.endState.z);
            }
            else {
                spec.endState.transform[12] = translate.endState.x;
                spec.endState.transform[13] = translate.endState.y;
                spec.endState.transform[14] = translate.endState.z;
            }
        }
        else {
            spec.transform = undefined;
            spec.endState.transform = undefined;
        }
        return this._spec;
    };

    FlowLayoutNode.prototype.stoppedFlowing = function() {
        return this._lockTransitionable.get() === 1 && !this._singleTween && this._pe.isSleeping() && !this._insertSpec;
    }

    /**
     * Helper function to set the property of a node (e.g. opacity, translate, etc..)
     */
    function _setPropertyValue(prop, propName, endState, defaultValue, transition) {
        //TODO: See if we can remove this
        var immediate = false;
        // Get property
        prop = prop || this._properties[propName];

        // Update the property
        if (prop && prop.init) {
            prop.invalidated = true;
            var value = defaultValue;
            if (endState !== undefined) {
                value = endState;
            }
            else if (this._removing) {
                value = prop.particle.getPosition();
            }
            // set new end state (the quick way)
            var newPropsAreDifferent = !_approxEqual3d(value, prop.endState);

            // If we reached an end state and we shouldn't go to another state
            if (this._pe.isSleeping() && !this._singleTween && newPropsAreDifferent && !this._disableSingleTween && transition) {
                _assignVectorFromArray(prop.endState, value);
                this._shouldDoSingleTween = true;
            } else {
                if (immediate) {
                    // set current state (the quick way)
                    prop.curState.x = prop.endState.x;
                    prop.curState.y = prop.endState.y;
                    prop.curState.z = prop.endState.z;
                    // reset velocity (the quick way)
                    prop.velocity.x = 0;
                    prop.velocity.y = 0;
                    prop.velocity.z = 0;
                }
                else if (newPropsAreDifferent) {
                    this._shouldDoSingleTween = false;
                    if (this._singleTween) {
                        if (!this._disableSingleTween) {
                            this._disableSingleTween = {}
                        }
                        this._disableSingleTween[propName] = true;
                        this.interruptPropertyTween(propName);
                    }
                    _assignVectorFromArray(prop.endState, value);


                    this._pe.wake();
                }
            }
        }
        else {
            /* Only do single tween if there's a transition specified */
            this._shouldDoSingleTween = !!transition;
            // Create property if neccesary
            var wasSleeping = this._pe.isSleeping();
            if (!prop) {
                prop = {
                    particle: new Particle({
                        position: (this._initial || immediate) ? endState : defaultValue
                    }),
                    endState: new Vector(endState)
                };


                prop.curState = prop.particle.position;

                prop.velocity = prop.particle.velocity;
                prop.force = new Spring(this.options.spring);
                prop.force.setOptions({
                    anchor: prop.endState
                });
                this._pe.addBody(prop.particle);
                prop.forceId = this._pe.attach(prop.force, prop.particle);
                this._properties[propName] = prop;
            }
            else {
                prop.particle.setPosition((this._initial || immediate) ? endState : defaultValue);
                prop.endState.set(endState);
            }
            if (!this._initial && !immediate) {
                if (wasSleeping && transition && !this._singleTween) {
                    this._shouldDoSingleTween = true;
                    this._pe.sleep()
                } else {
                    this._pe.wake();
                }
            }
            else if (wasSleeping) {
                this._pe.sleep(); // nothing has changed, put back to sleep
            }
            if (this.options.properties[propName] && this.options.properties[propName].length) {
                prop.enabled = this.options.properties[propName];
            }
            else {
                prop.enabled = [
                    this.options.properties[propName],
                    this.options.properties[propName],
                    this.options.properties[propName]
                ];
            }
            prop.init = true;
            prop.invalidated = true;
        }
        prop.noAnimation = false;
    }


    /**
     * Get value if not equals.
     */
    function _getIfNE2D(a1, a2) {
        return ((a1[0] === a2[0]) && (a1[1] === a2[1])) ? undefined : a1;
    }

    function _getIfNE3D(a1, a2) {
        return ((a1[0] === a2[0]) && (a1[1] === a2[1]) && (a1[2] === a2[2])) ? undefined : a1;
    }

    function _approxEqual3d(array, vector) {
        return ['x', 'y', 'z'].every(function (dimension, index) {
            return (array.length <= index || array[index] === true || Math.abs(array[index] - vector[dimension]) < 0.01);
        });
    }

    function _assignVectorFromArray(vector, array) {
        vector.x = array[0] === true ? vector.x : array[0];
        vector.y = (array.length > 1) ? array[1] === true ? vector.y : array[1] : 0;
        vector.z = (array.length > 2) ? array[2] : 0;
    }


    /**
     * context.set(..)
     */
    FlowLayoutNode.prototype.set = function (set, defaultSize) {
        /* If an insert spec is specified, we assume removed (non-existing) by default */
        this._exists = true;

        if (defaultSize) {
            this._removing = false;
        }
        this._invalidated = true;
        this.scrollLength = set.scrollLength;
        this._specModified = true;

        this._spec.hide = set.hide;

        // opacity
        var prop = this._properties.opacity;
        var value = set.opacity !== undefined ? set.opacity : 1;
        if (this._insertSpec && this._insertSpec.opacity !== undefined) {
            _setPropertyValue.call(this, prop, 'opacity', [this._insertSpec.opacity * value, 0], DEFAULT.opacity2D, set.transition);
        }
        var prop = this._properties.opacity;
        _setPropertyValue.call(this, prop, 'opacity', [value, 0], DEFAULT.opacity2D, set.transition);


        // set align
        prop = this._properties.align;
        value = set.align ? _getIfNE2D(set.align, DEFAULT.align) : undefined;
        if (this._insertSpec && this._insertSpec.align) {
            var initial = this._insertSpec.align;
            _setPropertyValue.call(this, prop, 'align', initial, DEFAULT.align, set.transition);
        }
        prop = this._properties.align;
        if (value || (prop && prop.init)) {
            _setPropertyValue.call(this, prop, 'align', value, DEFAULT.align, set.transition);
        }

        // set orgin
        prop = this._properties.origin;
        value = set.origin ? _getIfNE2D(set.origin, DEFAULT.origin) : undefined;
        if (this._insertSpec && this._insertSpec.origin) {
            var initial = this._insertSpec.origin;
            _setPropertyValue.call(this, prop, 'origin', initial, DEFAULT.origin, set.transition);
        }
        prop = this._properties.origin;
        if (value || (prop && prop.init)) {
            _setPropertyValue.call(this, prop, 'origin', value, DEFAULT.origin, set.transition);
        }

        // set size
        prop = this._properties.size;
        if (this._insertSpec && this._insertSpec.size) {
            var initial = this._insertSpec.size;
            _setPropertyValue.call(this, prop, 'size', initial, defaultSize, set.transition);
        }
        prop = this._properties.size;
        value = set.size || defaultSize;
        if (value || (prop && prop.init)) {
            _setPropertyValue.call(this, prop, 'size', value, defaultSize, set.transition);
        }

        // set translate
        prop = this._properties.translate;
        value = set.translate;
        if (value || (prop && prop.init)) {
            if (this._insertSpec && this._insertSpec.translate) {
                var initial = this._insertSpec.translate;
                _setPropertyValue.call(this, prop, 'translate', [0, 1, 2].map(function (index) {
                    return initial[index] + value[index]
                }), DEFAULT.translate, undefined, true);
            }
            _setPropertyValue.call(this, prop, 'translate', value, DEFAULT.translate, set.transition);
        }

        // set scale
        prop = this._properties.scale;
        value = set.scale ? _getIfNE3D(set.scale, DEFAULT.scale) : undefined;
        if (this._insertSpec && this._insertSpec.scale) {
            var initial = this._insertSpec.scale;
            _setPropertyValue.call(this, prop, 'scale', initial, DEFAULT.scale, set.transition);
        }
        prop = this._properties.scale; //TODO check if this line is necessary
        if (value !== undefined || (prop && prop.init)) {
            _setPropertyValue.call(this, prop, 'scale', value, DEFAULT.scale, set.transition);
        }


        // set rotate
        prop = this._properties.rotate;
        value = set.rotate ? _getIfNE3D(set.rotate, DEFAULT.rotate) : undefined;
        if (this._insertSpec && this._insertSpec.rotate) {
            var initial = this._insertSpec.rotate;
            _setPropertyValue.call(this, prop, 'rotate', initial, DEFAULT.rotate, set.transition);
        }
        prop = this._properties.rotate; //TODO check if this line is necessary
        if(value !== undefined || (prop && prop.init)){
            _setPropertyValue.call(this, prop, 'rotate', value, DEFAULT.rotate, set.transition);
        }


        // set skew
        prop = this._properties.skew;
        value = set.skew ? _getIfNE3D(set.skew, DEFAULT.skew) : undefined;
        if (this._insertSpec && this._insertSpec.skew) {
            var initial = this._insertSpec.skew;
            _setPropertyValue.call(this, prop, 'skew', initial, DEFAULT.skew, set.transition);
        }
        if (value !== undefined || (prop && prop.init)) {
            _setPropertyValue.call(this, prop, 'skew', value, DEFAULT.skew, set.transition);
        }

        if (set.callback) {
            if (this._currentCallback && this._currentCallback !== set.callback) {
                /* Interrupt */
                this._currentCallback({ reason: 'flowInterrupted' });
            }
            this._currentCallback = set.callback;
        }


        if (this._shouldDoSingleTween) {
            var givenTransformation = typeof set.transition === 'function' ? set : set.transition;
            /* Reset variable */
            this._shouldDoSingleTween = false;
            this._singleTweenProperties = givenTransformation || {
                    curve: function linear(x) {
                        return x;
                    }, duration: 1000
                };
            this.releaseLock(true, this._singleTweenProperties, function () {
                if (this._singleTween) {
                    this._singleTween = false;
                    for (var propName in this._properties) {
                        var prop = this._properties[propName];
                        if (prop && prop.init) {
                            prop.curState.x = prop.endState.x;
                            prop.curState.y = prop.endState.y;
                            prop.curState.z = prop.endState.z;
                        }
                    }
                    this._completeFlowCallback({ reason: 'flowEnd' });
                }
            }.bind(this));
            this._singleTween = true;
        } else if (this._disableSingleTween) {
            /* This will have FlowLayoutNode.set() called again the next render tick, at which point _shouldDoSingleTween will have been set to true again. */
            this._singleTween = false;
            for (var otherPropName in this._properties) {
                if (!(otherPropName in this._disableSingleTween)) {
                    this.interruptPropertyTween(otherPropName);
                }
            }
            this._disableSingleTween = false;


            this.releaseLock();
        } else if (this._pe.isSleeping() && !this._singleTween) {
            /* The props of the renderable have not changed, yet it was reflown. No tweening will be performed. */
            this._completeFlowCallback({ reason: 'flowSkipped' });
        }

        this._insertSpec = undefined;
    };


    FlowLayoutNode.prototype.interruptPropertyTween = function (propertyName) {
        var lockVar = this._lockTransitionable.get();
        //Complex code for calculating the velocity of the current ongoing animation
        var velocity = this._lockTransitionable.velocity;
        var curve = this._singleTweenProperties.curve || function linear(x) {
                return x
            };
        var duration = this._singleTweenProperties.duration;
        var epsilon = 1e-7;
        var curveDelta = (curve(lockVar) - curve(lockVar - epsilon)) / epsilon;
        var adjustedProp = this._properties[propertyName];
        ['x', 'y', 'z'].forEach(function (dimension) {
            var distanceToTravel = (adjustedProp.endState[dimension] - adjustedProp.curState[dimension]);
            var distanceTraveled = distanceToTravel * lockVar;
            if (!duration) {
                adjustedProp.curState[dimension] = adjustedProp.endState[dimension];
            } else {
                adjustedProp.velocity[dimension] = -1 * curveDelta * (adjustedProp.curState[dimension] - adjustedProp.endState[dimension]) / duration;
                adjustedProp.curState[dimension] = (adjustedProp.curState[dimension] + distanceTraveled) || 0;
            }
        });
    };

    FlowLayoutNode.prototype._completeFlowCallback = function (options) {
        if (this._currentCallback) {
            this._currentCallback(options);
            delete this._currentCallback;
        }
    };

    module.exports = FlowLayoutNode;
});
