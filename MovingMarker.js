L.interpolatePosition = function (p1, p2, duration, t) {
    var k = t / duration;
    k = (k > 0) ? k : 0;
    k = (k > 1) ? 1 : k;
    return L.latLng(p1.lat + k * (p2.lat - p1.lat),
        p1.lng + k * (p2.lng - p1.lng));
};

L.getAngle = function (cx, cy, ex, ey) {
    var dy = ey - cy;
    var dx = ex - cx;
    var theta = Math.atan2(dy, dx); // range (-PI, PI]
    theta *= 180 / Math.PI; // rads to degs, range (-180, 180]
    // if (theta < 0) theta = 360 + theta; // range [0, 360)
    return theta;
};

L.Marker.MovingMarker = L.Marker.extend({
    //state constants
    statics: {
        notStartedState: 0,
        endedState: 1,
        pausedState: 2,
        runState: 3
    },

    options: {
        autostart: false,
        loop: false,
        rotate: false,
        initialRotationAngle: 0,
        rotationOrigin: "center",
    },

    now: function () {
        return Date.now();
    },

    initialize: function (latlngs, durations, options, cbmove, cbresetpos) {
        this.cbmove = cbmove;
        this.cbresetpos = cbresetpos;

        L.Marker.prototype.initialize.call(this, latlngs[0], options);

        this._latlngs = latlngs.map(function (e, index) {
            return L.latLng(e);
        });

        if (durations instanceof Array) {
            this._durations = durations;
        } else {
            this._durations = this._createDurations(this._latlngs, durations);
        }

        this._currentDuration = 0;
        this._currentIndex = 0;

        this._state = L.Marker.MovingMarker.notStartedState;
        this._startTime = 0;
        this._pauseStartTime = 0;
        this._currentLine = [];
        this._stations = {};
    },

    isRunning: function () {
        return this._state === L.Marker.MovingMarker.runState;
    },

    isEnded: function () {
        return this._state === L.Marker.MovingMarker.endedState;
    },

    isStarted: function () {
        return this._state !== L.Marker.MovingMarker.notStartedState;
    },

    isPaused: function () {
        return this._state === L.Marker.MovingMarker.pausedState;
    },

    start: function () {
        if (this.isRunning()) {
            return;
        }

        if (this.isPaused()) {
            this.resume();
        } else {
            this._loadLine(0);
            // callback: reset
            if (this.cbresetpos) {
                this.cbresetpos();
            }
            this._startAnimation();
            this.fire('start');
        }
    },

    setcurpos: function (val) {
        var totaltime = 0;
        for (const it of this._durations) {
            totaltime += it;
        }
        var passtime = totaltime * val;

        this._loadLine(0);

        var now = this.now();
        this._startTime = now - passtime;
        this._pauseStartTime = now;

        // callback: reset
        if (this.cbresetpos) {
            this.cbresetpos();
        }

        // callback: move to start
        if (this.cbmove && this._latlngs.length) {
            this.cbmove(this._latlngs[0]);
        }

        // update line & move position
        this._animate(true);
    },

    resume: function () {
        if (!this.isPaused()) {
            return;
        }
        // update the current line
        this._currentLine[0] = this.getLatLng();
        this._currentDuration -= (this._pauseStartTime - this._startTime);
        this._startAnimation();
    },

    pause: function () {
        if (!this.isRunning()) {
            return;
        }

        this._pauseStartTime = this.now();
        this._state = L.Marker.MovingMarker.pausedState;
    },

    stop: function () {
        if (this.isEnded()) {
            return;
        }

        this._pauseStartTime = this.now();
        this._state = L.Marker.MovingMarker.endedState;
        this.fire('end', {});
    },

    addLatLng: function (latlng, duration) {
        this._latlngs.push(L.latLng(latlng));
        this._durations.push(duration);
    },

    moveTo: function (latlng, duration) {
        this._latlngs.push(L.latLng(latlng));
        this._durations.push(duration);

        if (this._state != L.Marker.MovingMarker.runState) {
            this._currentLine[0] = this.getLatLng();
            this._currentDuration -= (this._pauseStartTime - this._startTime);
            this._startAnimation();
        }
    },

    addStation: function (pointIndex, duration) {
        if (pointIndex > this._latlngs.length - 2 || pointIndex < 1) {
            return;
        }
        this._stations[pointIndex] = duration;
    },

    onAdd: function (map) {
        L.Marker.prototype.onAdd.call(this, map);

        if (this.options.autostart && (!this.isStarted())) {
            this.start();
        }
    },

    onRemove: function (map) {
        L.Marker.prototype.onRemove.call(this, map);
        this._state = L.Marker.MovingMarker.endedState;
    },

    _createDurations: function (latlngs, duration) {
        var lastIndex = latlngs.length - 1;
        var distances = [];
        var totalDistance = 0;
        var distance = 0;

        // compute array of distances between points
        for (var i = 0; i < lastIndex; i++) {
            distance = latlngs[i + 1].distanceTo(latlngs[i]);
            distances.push(distance);
            totalDistance += distance;
        }

        var ratioDuration = duration / totalDistance;

        var durations = [];
        for (i = 0; i < distances.length; i++) {
            durations.push(distances[i] * ratioDuration);
        }

        return durations;
    },

    _startAnimation: function () {
        this._state = L.Marker.MovingMarker.runState;

        this._startTime = this.now();
        this._animate();
    },

    _updatePosition: function () {
        this._animate(true);
    },

    _updateRotation: function () {
        if (this._rotationAngle) {
            this._icon.style[
                L.DomUtil.TRANSFORM + "Origin"
            ] = this.options.rotationOrigin;

            this._icon.style[L.DomUtil.TRANSFORM] +=
                " rotateZ(" +
                (this.options.initialRotationAngle + this._rotationAngle) +
                "deg)";
        }
    },

    _loadLine: function (index) {
        this._currentIndex = index;
        this._currentDuration = this._durations[index];
        this._currentLine = this._latlngs.slice(index, index + 2);

        if (this.options.rotate) {
            // set direction
            this._rotationAngle = L.getAngle(
                this._currentLine[0].lat,
                this._currentLine[0].lng,
                this._currentLine[1].lat,
                this._currentLine[1].lng
            );
        }
    },

    /**
     * Load the line where the marker is
     * @param  {Number} timestamp
     * @return {Number} elapsed time on the current line or null if
     * we reached the end or marker is at a station
     */
    _updateLine: function (timestamp) {
        // time elapsed since the last latlng
        var elapsedTime = timestamp - this._startTime;

        // not enough time to update the line
        if (elapsedTime <= this._currentDuration) {
            return elapsedTime;
        }

        var lineIndex = this._currentIndex;
        var lineDuration = this._currentDuration;
        var stationDuration;

        while (elapsedTime > lineDuration) {
            // substract time of the current line
            elapsedTime -= lineDuration;
            stationDuration = this._stations[lineIndex + 1];

            // test if there is a station at the end of the line
            if (stationDuration !== undefined) {
                if (elapsedTime < stationDuration) {
                    this._setLatLngWithCb(this._latlngs[lineIndex + 1]);
                    return null;
                }
                elapsedTime -= stationDuration;
            }

            lineIndex++;

            // key point
            if (this.cbmove) {
                this.cbmove(this._latlngs[lineIndex])
            }

            // test if we have reached the end of the polyline
            if (lineIndex >= this._latlngs.length - 1) {

                if (this.options.loop) {
                    lineIndex = 0;
                    this.fire('loop', {
                        elapsedTime: elapsedTime
                    });
                } else {
                    // place the marker at the end, else it would be at
                    // the last position
                    this._setLatLngWithCb(this._latlngs[this._latlngs.length - 1]);
                    this.stop();
                    return null;
                }
            }
            lineDuration = this._durations[lineIndex];
        }

        this._loadLine(lineIndex);
        this._startTime = this.now() - elapsedTime;
        return elapsedTime;
    },

    _setLatLngWithCb: function (p) {
        this.setLatLng(p);
        if (this.options.rotate) {
            this._updateRotation();
        }
        if (this.cbmove) {
            this.cbmove(p)
        }
    },

    _animate: function (noRequestAnim) {
        // find the next line and compute the new elapsedTime
        var elapsedTime = this._updateLine(this.now());

        if (elapsedTime != null) {
            // compute the position
            var p = L.interpolatePosition(this._currentLine[0],
                this._currentLine[1],
                this._currentDuration,
                elapsedTime);
            this._setLatLngWithCb(p);
        }

        if (noRequestAnim || !this.isRunning()) {
            return;
        }

        L.Util.requestAnimFrame(() => {
            this._animate();
        }, this, false);
    }
});

L.Marker.movingMarker = function (latlngs, duration, options, cbmove, cbresetpos) {
    return new L.Marker.MovingMarker(latlngs, duration, options, cbmove, cbresetpos);
};