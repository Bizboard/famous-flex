/**
 * This Source Code is licensed under the MIT license. If a copy of the
 * MIT-license was not distributed with this file, You can obtain one at:
 * http://opensource.org/licenses/mit-license.html.
 *
 * @author: Hein Rutjes (IjzerenHein)
 * @license MIT
 * @copyright Gloey Apps, 2014
 */

/**
 * Internal LayoutNode class used by `LayoutController`.
 *
 * @module
 */
define(function (require, exports, module) {

    var Transitionable = require('famous/transitions/Transitionable');
    var Transform = require('famous/core/Transform');
    var LayoutUtility = require('./LayoutUtility');

    /**
     * @class
     * @param {Object} renderNode Render-node which this layout-node represents
     * @alias module:LayoutNode
     */
    function LayoutNode(renderNode, spec) {
        this.renderNode = renderNode;
        this._spec = spec ? LayoutUtility.cloneSpec(spec) : {};
        this._spec.renderNode = renderNode; // also store in spec
        this._specModified = true;
        this._invalidated = false;
        this._removing = false;
    }

    /**
     * Called to update the underlying render-node
     */
    LayoutNode.prototype.setRenderNode = function (renderNode) {
        this.renderNode = renderNode;
        this._spec.renderNode = renderNode;
    };

    /**
     * Called to update the options for the node
     */
    LayoutNode.prototype.setOptions = function (options) {
        // override to implement
    };

    /**
     * Called when the node is destroyed
     */
    LayoutNode.prototype.destroy = function () {
        this.renderNode = undefined;
        this._spec.renderNode = undefined;
        this._viewSequence = undefined;
    };

    /**
     * Reset the end-state. This function is called on all layout-nodes prior to
     * calling the layout-function. So that the layout-function starts with a clean slate.
     */
    LayoutNode.prototype.reset = function () {
        this._invalidated = false;
        this.trueSizeRequested = false;
    };

    /**
     * Set the spec of the node
     *
     * @param {Object} spec
     */
    LayoutNode.prototype.setSpec = function (spec) {
        this._specModified = true;
        if (spec.align) {
            if (!spec.align) {
                this._spec.align = [0, 0];
            }
            this._spec.align[0] = spec.align[0];
            this._spec.align[1] = spec.align[1];
        }
        else {
            this._spec.align = undefined;
        }
        if (spec.origin) {
            if (!spec.origin) {
                this._spec.origin = [0, 0];
            }
            this._spec.origin[0] = spec.origin[0];
            this._spec.origin[1] = spec.origin[1];
        }
        else {
            this._spec.origin = undefined;
        }
        if (spec.size) {
            if (!spec.size) {
                this._spec.size = [0, 0];
            }
            this._spec.size[0] = spec.size[0];
            this._spec.size[1] = spec.size[1];
        }
        else {
            this._spec.size = undefined;
        }

        this._spec.hide = spec.hide;

        if (spec.transform) {
            if (!spec.transform) {
                this._spec.transform = spec.transform.slice(0);
            }
            else {
                for (var i = 0; i < 16; i++) {
                    this._spec.transform[i] = spec.transform[i];
                }
            }
        }
        else {
            this._spec.transform = undefined;
        }
        this._spec.opacity = spec.opacity;
    };

    /**
     * Initiates a transition on the layout node
     * @param transition
     * @param {Function} onComplete callback when complete
     */
    LayoutNode.prototype.transition = function (transition, onComplete) {

        this._originalSet = this._transitionable ?
            /* If there's already something in progress, then interpolate the current starting position */
            this._interpolateSet() :
            /* Otherwise, it's the most recent set */
            this._lastSet;
        var transitionable = this._transitionable = new Transitionable(0);
        if(!transition.duration){
            transition.duration = 200;
        }
        transitionable.set(1, transition, function() {
            /* If the transitionable wasn't replaced by another transitionable, then delete the transitionable
            * because we are finished */
            if (this._transitionable === transitionable) {
                delete this._transitionable;
                this._originalSet = this._targetSet;
                if(onComplete){
                    onComplete();
                }
            }
        })
    };


    /**
     * Set the content of the node
     *
     * @param {Object} set
     */
    LayoutNode.prototype.set = function (set, size) {

        var transition = set.transition;

        if (transition) {
            this._targetSet = set;
            if (!this._transitionable) {
                var transitionable = this._transitionable = new Transitionable(0);
                transitionable.set(1, transition, function()  {
                    /* If the transitionable wasn't replaced by another transitionable, then delete the transitionable
                    * because we are finished */
                    if (this._transitionable === transitionable) {
                        delete this._transitionable;
                        this._originalSet = this._targetSet;
                    }
                })
            }
        }
        if (!this._transitionable) {
            this._originalSet = set;
        }

        this._lastSet = set;
        this._invalidated = true;
        this._specModified = true;
        this._removing = false;
        this._modifySpecFromSet(this._spec, set);
        this.scrollLength = set.scrollLength;
    };

    var propertiesWithDefaults = {
        size: [undefined, undefined],
        origin: [0, 0],
        align: [0, 0],
        skew: [0, 0, 0],
        rotate: [0, 0, 0],
        scale: [1, 1, 1],
        translate: [0, 0, 0],
        opacity: [1]
    };

    LayoutNode.prototype._modifySpecFromSet = function (spec, set) {
        spec.opacity = set.opacity;

        var propertiesWithEasyDefaults = ['size', 'origin', 'align'];
        for (var i = 0; i < propertiesWithEasyDefaults.length; i++) {
            var propertyName = propertiesWithEasyDefaults[i];
            var defaultProperty = propertiesWithDefaults[propertyName];
            spec[propertyName] = set[propertyName] ? [
                set[propertyName][0] === undefined ? defaultProperty[0] : set[propertyName][0],
                set[propertyName][1] === undefined ? defaultProperty[1] : set[propertyName][1]
            ] : undefined;
        }

        spec.hide = set.hide;

        if (set.skew || set.rotate || set.scale) {
            spec.transform = Transform.build({
                translate: set.translate || [0, 0, 0],
                skew: set.skew || [0, 0, 0],
                scale: set.scale || [1, 1, 1],
                rotate: set.rotate || [0, 0, 0]
            });
        }
        else {
            spec.transform = set.translate ?
                Transform.translate(set.translate[0], set.translate[1], set.translate[2]) :
                undefined;
        }
    };

    /**
     * Creates the render-spec
     */
    LayoutNode.prototype.getSpec = function () {
        this._specModified = false;
        this._spec.removed = !this._invalidated;
        return this._getFinalSpec();
    };



    /**
     * Gets the calculated spec based on the time passed, or what the last setting was
     * @returns {*}
     * @private
     */
    LayoutNode.prototype._getFinalSpec = function () {
        if (this._transitionable && !this._spec.hide) {
            if (!this._transitionable.isActive()) {
                delete this._transitionable;
            }
            var spec = {renderNode: this._spec.renderNode};
            this._modifySpecFromSet(spec, this._interpolateSet());
            return spec;
        }


        return this._spec;

    };

    /**
     * Interpolates an ongoing animation
     * @returns {Object|*}
     * @private
     */
    LayoutNode.prototype._interpolateSet = function () {
        var tweenValue = this._transitionable.get();
        if (!this._originalSet || tweenValue === 1) {
            return this._lastSet;
        }
        var resultingSet = {};
        var tweenToSet = this._lastSet;
        var tweenFromSet = this._originalSet;

        for(var property in propertiesWithDefaults){
            var defaultProperty = propertiesWithDefaults[property];
            var tweenFrom = tweenFromSet[property] !== undefined ? tweenFromSet[property] : defaultProperty;
            var tweenTo = tweenToSet[property] !== undefined ? tweenToSet[property] : tweenFrom;
            if(tweenTo === tweenFrom){
                resultingSet[property] = tweenTo;
                continue;
            }
            tweenTo = Array.isArray(tweenTo) ? tweenTo : [tweenTo];
            tweenFrom = Array.isArray(tweenFrom) ? tweenFrom: [tweenFrom];
            this._specModified = true;
            var numberOfDimensions = defaultProperty.length;
            /* Clone the property so that we can start from the default setting */
            var tweenedSet = resultingSet[property] = new Array(numberOfDimensions);
            for(var dimension = 0;dimension<numberOfDimensions;dimension++){
                tweenedSet[dimension] = tweenFrom[dimension] + (tweenTo[dimension] - tweenFrom[dimension]) * tweenValue;
            }
        }
        resultingSet.opacity = resultingSet.opacity[0];
        return resultingSet;
    };
    /**
     * Marks the node for removal
     */
    LayoutNode.prototype.remove = function (removeSpec) {
        this._removing = true;
    };

    module.exports = LayoutNode;
});
