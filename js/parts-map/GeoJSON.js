(function (H) {
	var defaultOptions = H.defaultOptions,
		Chart = H.Chart,
		each = H.each,
		extend = H.extend,
		error = H.error,
		win = H.win,
		wrap = H.wrap;
/** 
 * Test for point in polygon. Polygon defined as array of [x,y] points.
 */
function pointInPolygon(point, polygon) {
	var i, j, rel1, rel2, c = false,
		x = point.x,
		y = point.y;

	for (i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		rel1 = polygon[i][1] > y;
		rel2 = polygon[j][1] > y;
		if (rel1 !== rel2 && (x < (polygon[j][0] - polygon[i][0]) * (y - polygon[i][1]) / (polygon[j][1] - polygon[i][1]) + polygon[i][0])) {
			c = !c;
		}
	}

	return c;
}

/**
 * Get point from latLon using specified transform definition
 */
Chart.prototype.transformFromLatLon = function (latLon, transform) {
	if (win.proj4 === undefined) {
		error(21);
		return {
			x: 0,
			y: null
		};
	}

	var projected = win.proj4(transform.crs, [latLon.lon, latLon.lat]),
		cosAngle = transform.cosAngle || (transform.rotation && Math.cos(transform.rotation)),
		sinAngle = transform.sinAngle || (transform.rotation && Math.sin(transform.rotation)),
		rotated = transform.rotation ? [projected[0] * cosAngle + projected[1] * sinAngle, -projected[0] * sinAngle + projected[1] * cosAngle] : projected;

	return {
		x: ((rotated[0] - (transform.xoffset || 0)) * (transform.scale || 1) + (transform.xpan || 0)) * (transform.jsonres || 1) + (transform.jsonmarginX || 0),
		y: (((transform.yoffset || 0) - rotated[1]) * (transform.scale || 1) + (transform.ypan || 0)) * (transform.jsonres || 1) - (transform.jsonmarginY || 0)
	};
};

/**
 * Get latLon from point using specified transform definition
 */
Chart.prototype.transformToLatLon = function (point, transform) {
	if (win.proj4 === undefined) {
		error(21);
		return;
	}

	var normalized = {
			x: ((point.x - (transform.jsonmarginX || 0)) / (transform.jsonres || 1) - (transform.xpan || 0)) / (transform.scale || 1) + (transform.xoffset || 0),
			y: ((-point.y - (transform.jsonmarginY || 0)) / (transform.jsonres || 1) + (transform.ypan || 0)) / (transform.scale || 1) + (transform.yoffset || 0)
		},
		cosAngle = transform.cosAngle || (transform.rotation && Math.cos(transform.rotation)),
		sinAngle = transform.sinAngle || (transform.rotation && Math.sin(transform.rotation)),
		// Note: Inverted sinAngle to reverse rotation direction
		projected = win.proj4(transform.crs, 'WGS84', transform.rotation ? {
			x: normalized.x * cosAngle + normalized.y * -sinAngle,
			y: normalized.x * sinAngle + normalized.y * cosAngle
		} : normalized);

	return { lat: projected.y, lon: projected.x };
};

Chart.prototype.fromPointToLatLon = function (point) {
	var transforms = this.mapTransforms,
		transform;

	if (!transforms) {
		error(22);
		return;
	}

	for (transform in transforms) {
		if (transforms.hasOwnProperty(transform) && transforms[transform].hitZone && 
				pointInPolygon({ x: point.x, y: -point.y }, transforms[transform].hitZone.coordinates[0])) {
			return this.transformToLatLon(point, transforms[transform]);
		}
	}

	return this.transformToLatLon(point, transforms['default']); // eslint-disable-line dot-notation
};

Chart.prototype.fromLatLonToPoint = function (latLon) {
	var transforms = this.mapTransforms,
		transform,
		coords;

	if (!transforms) {
		error(22);
		return {
			x: 0,
			y: null
		};
	}

	for (transform in transforms) {
		if (transforms.hasOwnProperty(transform) && transforms[transform].hitZone) {
			coords = this.transformFromLatLon(latLon, transforms[transform]);
			if (pointInPolygon({ x: coords.x, y: -coords.y }, transforms[transform].hitZone.coordinates[0])) {
				return coords;
			}
		}
	}

	return this.transformFromLatLon(latLon, transforms['default']); // eslint-disable-line dot-notation
};

/**
 * Convert a geojson object to map data of a given Highcharts type (map, mappoint or mapline).
 */
H.geojson = function (geojson, hType, series) {
	var mapData = [],
		path = [],
		polygonToPath = function (polygon) {
			var i,
				len = polygon.length;
			path.push('M');
			for (i = 0; i < len; i++) {
				if (i === 1) {
					path.push('L');
				}
				path.push(polygon[i][0], -polygon[i][1]);
			}
		};

	hType = hType || 'map';

	each(geojson.features, function (feature) {

		var geometry = feature.geometry,
			type = geometry.type,
			coordinates = geometry.coordinates,
			properties = feature.properties,
			point;

		path = [];

		if (hType === 'map' || hType === 'mapbubble') {
			if (type === 'Polygon') {
				each(coordinates, polygonToPath);
				path.push('Z');

			} else if (type === 'MultiPolygon') {
				each(coordinates, function (items) {
					each(items, polygonToPath);
				});
				path.push('Z');
			}

			if (path.length) {
				point = { path: path };
			}

		} else if (hType === 'mapline') {
			if (type === 'LineString') {
				polygonToPath(coordinates);
			} else if (type === 'MultiLineString') {
				each(coordinates, polygonToPath);
			}

			if (path.length) {
				point = { path: path };
			}

		} else if (hType === 'mappoint') {
			if (type === 'Point') {
				point = {
					x: coordinates[0],
					y: -coordinates[1]
				};
			}
		}
		if (point) {
			mapData.push(extend(point, {
				name: properties.name || properties.NAME,
				properties: properties
			}));
		}

	});

	// Create a credits text that includes map source, to be picked up in Chart.showCredits
	if (series && geojson.copyrightShort) {
		series.chart.mapCredits = format(series.chart.options.credits.mapText, { geojson: geojson });
		series.chart.mapCreditsFull = format(series.chart.options.credits.mapTextFull, { geojson: geojson });
	}

	return mapData;
};

/**
 * Override showCredits to include map source by default
 */
wrap(Chart.prototype, 'showCredits', function (proceed, credits) {

	// Disable credits link if map credits enabled. This to allow for in-text anchors.
	if (this.mapCredits) {
		credits.href = null;
	}

	proceed.call(this, Highcharts.merge(credits, {
		text: credits.text + (this.mapCredits || '') // Add map credits to credits text
	}));

	// Add full map credits to hover
	if (this.credits && this.mapCreditsFull) {
		this.credits.attr({
			title: this.mapCreditsFull
		});
	}
});

	return H;
}(Highcharts));
