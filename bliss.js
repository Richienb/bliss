(function() {
"use strict";

// Copy properties from one object to another. Overwrites allowed.
function extend(to, from, whitelist) {
	for (var property in from) {
		if (whitelist) {
			var type = $.type(whitelist);

			if (whitelist === "own" && !from.hasOwnProperty(property) ||
				type === "array" && whitelist.indexOf(property) === -1 ||
				type === "regexp" && !whitelist.test(property) ||
				type === "function" && !whitelist.call(from, property)) {
				continue;
			}
		}

		// To copy gettters/setters, preserve flags etc
		var descriptor = Object.getOwnPropertyDescriptor(from, property);

		if (descriptor && (!descriptor.writable || !descriptor.configurable || !descriptor.enumerable || descriptor.get || descriptor.set)) {
			delete to[property];
			Object.defineProperty(to, property, descriptor);
		}
		else {
			to[property] = from[property];
		}
	}
	
	return to;
};

var $ = self.Bliss = extend(function(expr, context) {
	return $.type(expr) === "string"? (context || document).querySelector(expr) : expr || null;
}, self.Bliss);

extend($, {
	extend: extend,

	property: $.property || "_",

	sources: {},

	$: function(expr, context) {
		return expr instanceof Node || expr instanceof Window? [expr] :
		       [].slice.call(typeof expr == "string"? (context || document).querySelectorAll(expr) : expr || []);
	},
	
	/**
	 * Returns the [[Class]] of an object in lowercase (eg. array, date, regexp, string etc)
	 */
	type: function(obj) {
		if (obj === null) { return 'null'; }
	
		if (obj === undefined) { return 'undefined'; }
	
		var ret = (Object.prototype.toString.call(obj).match(/^\[object\s+(.*?)\]$/)[1] || "").toLowerCase();
	
		if(ret == 'number' && isNaN(obj)) {
			return 'nan';
		}
	
		return ret;
	},
	
	/*
	 * Return first non-undefined value. Mainly used internally.
	 */
	defined: function () {
		for (var i=0; i<arguments.length; i++) {
			if (arguments[i] !== undefined) {
				return arguments[i];
			}
		}
	},
	
	create: function (tag, o) {
		if (arguments.length === 1) {
			if ($.type(tag) === "string") {
				return document.createTextNode(o);
			}
			
			o = tag;
			tag = o.tag;			
		}
		
		// TODO Do we need an o.document option for different documents?
		// One can always use $.set(otherDocument.createElement(), o), but what about $.contents()?
		return $.set(document.createElement(tag), o);
	},

	ready: function(context) {
		context = context || document;

		return new Promise(function(resolve, reject){
			if (context.readyState !== "loading") {
				resolve();
			}
			else {
				context.addEventListener("DOMContentLoaded", function(){
					resolve();
				});
			}
		});
	},

	// Lazily evaluated properties
	lazy: function(obj, property, getter) {
		if (arguments.length >= 3) {
			Object.defineProperty(obj, property, {
				get: function() {
					// FIXME this does not work for instances if property is defined on the prototype
					delete this[property];

					try { this[property] = 5;
					} catch(e) {console.error(e)}

					return this[property] = getter.call(this);
				},
				configurable: true,
				enumerable: true
			});
		}
		else if (arguments.length === 2) {
			for (var prop in property) {
				$.lazy(obj, prop, property[prop]);
			}
		}
	},

	// Properties that behave like normal properties but also execute code upon getting/setting
	live: function(obj, property, descriptor) {
		if (arguments.length >= 3) {
			Object.defineProperty(obj, property, {
				get: function() {
					var value = this["_" + property];
					var ret = descriptor.get && descriptor.get.call(this, value);
					return ret !== undefined? ret : value;
				},
				set: function(v) {
					var value = this["_" + property];
					var ret = descriptor.set && descriptor.set.call(this, v, value);
					this["_" + property] = ret !== undefined? ret : v;
				},
				configurable: descriptor.configurable,
				enumerable: descriptor.enumerable
			});
		}
		else if (arguments.length === 2) {
			for (var prop in property) {
				$.stored(obj, prop, property[prop]);
			}
		}
	},

	// Helper for defining OOP-like “classes”
	Class: function(o) {
		var init = o.constructor || function(){};
		delete o.constructor;

		var abstract = o.abstract;
		delete o.abstract;

		var ret = function() {
			if (abstract && this.constructor === ret) {
				throw new Error("Abstract classes cannot be directly instantiated.");
			}

			if (this.constructor.super && this.constructor.super != ret) {
				// FIXME This should never happen, but for some reason it does if ret.super is null
				// Debugging revealed that somehow this.constructor !== ret, wtf. Must look more into this
				this.constructor.super.apply(this, arguments);
			}

			return init.apply(this, arguments);
		};

		ret.super = o.extends || null;
		delete o.extends;

		ret.prototype = $.extend(Object.create(ret.super && ret.super.prototype), {
			constructor: ret
		});

		$.extend(ret, o.static);
		delete o.static;

		$.lazy(ret.prototype, o.lazy);
		delete o.lazy;

		$.stored(ret.prototype, o.stored);
		delete o.stored;

		// Anything that remains is an instance method/property or ret.prototype.constructor
		$.extend(ret.prototype, o);

		// For easier calling of super methods
		// This doesn't save us from having to use .call(this) though
		ret.prototype.super = ret.super? ret.super.prototype : null;
		
		return ret;
	},

	// Includes a script, returns a promise
	include: function() {
		var url = arguments[arguments.length - 1];
		var loaded = arguments.length === 2? arguments[0] : false;

		var script = document.createElement("script");

		return loaded? Promise.resolve() : new Promise(function(resolve, reject){
			$.set(script, {
				async: true,
				onload: function() {
					resolve();
					$.remove(script);
				},
				onerror: function() {
					reject();
				},
				src: url,
				inside: document.head
			});
		});
		
	},

	/*
	 * Fetch API inspired XHR helper. Returns promise.
	 */
	fetch: function(url, o) {
		if (!url) {
			throw new TypeError("URL parameter is mandatory and cannot be " + url);
		}

		// Set defaults & fixup arguments
		url = new URL(url, location);
		o = o || {};
		o.data = o.data || '';
		o.method = o.method || 'GET';
		o.headers = o.headers || {};

		// TODO use the Fetch API if available

		var xhr = new XMLHttpRequest();

		if (o.method === "GET" && o.data) {
			url.search += o.data;
		}
		
		document.body.setAttribute('data-loading', url);
		
		xhr.open(o.method, url, !o.sync);

		for (var property in o) {
			if (property in xhr) {
				try {
					xhr[property] = o[property];
				}
				catch (e) {
					self.console && console.error(e);
				}
			}
		}
		
		if (o.method !== 'GET' && !o.headers['Content-type'] && !o.headers['Content-Type']) {
			xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
		}
		
		for (var header in o.headers) {
			xhr.setRequestHeader(header, o.headers[header]);
		}
		
		return new Promise(function(resolve, reject){
			xhr.onload = function(){
				document.body.removeAttribute('data-loading');
					
				if (xhr.status === 0 || xhr.status >= 200 && xhr.status < 300 || xhr.status === 304) {
					// Success!
					resolve(xhr);
				}
				else {
					reject(Error(xhr.statusText));
				}
			
			};
			
			xhr.onerror = function() {
				reject(Error("Network Error"));
			};

			xhr.send(o.method === 'GET'? null : o.data);
		});
	}
});

var _ = $.property;

$.Element = function (subject) {
	this.subject = subject;

	// Author-defined element-related data
	this.data = {};

	// Internal Bliss element-related data
	this.bliss = {};
};

$.Element.prototype = {
	set: function (properties) {
		for (var property in properties) {
			if (property in $.setSpecial) {
				$.setSpecial[property].call(this, properties[property]);
			}
			else if (property in this) {
				this[property] = properties[property];
			}
			else {
				this.setAttribute(property, properties[property]);
			}
		}
	},

	// Run a CSS transition, return promise
	transition: function(props, duration) {
		duration = +duration || 400;

		return new Promise(function(resolve, reject){
			if ("transition" in this.style) {
				var me = this;

				// Get existing style
				var previous = $.extend({}, this.style, /^transition(Duration|Property)$/);

				$.style(this, {
					transitionDuration: (duration || 400) + "ms",
					transitionProperty: Object.keys(props).join(", ")
				});

				this.addEventListener("transitionend", function done(){
					clearTimeout(i);
					$.style(me, previous);
					me.removeEventListener(done);
					resolve(me);
				});

				// Failsafe, in case transitionend doesn’t fire
				var i = setTimeout(resolve, duration+50);

				$.style(this, props);
			}
			else {
				resolve(this);
			}
		}.bind(this));
	},
	
	// Remove element from the DOM
	remove: function() {
		this.parentNode && this.parentNode.removeChild(this);
	},
	
	// Fire a synthesized event on the element
	fire: function (type, properties) {
		var evt = document.createEvent("HTMLEvents");
				
		evt.initEvent(type, true, true );

		this.dispatchEvent($.extend(evt, properties));

		if (this[_]) {
			var fired = this[_].bliss.fired = this[_].bliss.fired || {};
			fired[type] = ++fired[type] || 1;
		}
	}
};

/*
 * Properties with custom handling in $.set()
 * Also available as functions directly on element._ and on $
 */
$.setSpecial = {
	// Set a bunch of inline CSS styles
	style: function (val) {
		$.extend(this.style, val);
	},
	
	// Set a bunch of attributes
	attributes: function (o) {
		for (var attribute in o) {
			this.setAttribute(attribute, o[attribute]);
		}
	},
	
	// Set a bunch of properties on the element
	properties: function (val) {
		$.extend(this, val);
	},
	
	// Bind one or more events to the element
	events: function (val) {
		if (val instanceof EventTarget) {
			var me = this;

			// Copy listeners
			if (val[_] && val[_].bliss) {
				var listeners = val[_].bliss.listeners;

				for (var type in listeners) {
					listeners[type].forEach(function(l){
						me.addEventListener(type, l.callback, l.capture);
					});
				}
			}

			// Copy inline events
			for (var onevent in val) {
				if (onevent.indexOf("on") === 0) {
					this[onevent] = val[onevent];
				}
			}
		}
		else {
			for (var events in val) {
				events.split(/\s+/).forEach(function (event) {
					this.addEventListener(event, val[events]);
				}, this);
			}
		}
	},

	once: function(val) {
		for (var events in val) {
			events.split(/\s+/).forEach(function (event) {
				this.addEventListener(event, function callback() {
					me.removeEventListener(event, callback);
					return val[events].apply(this, arguments);
				});
			}, this);
		}
	},

	// Event delegation
	delegate: function(val) {
		if (arguments.length === 3) {
			// Called with ("type", "selector", callback)
			val = {};
			val[arguments[0]] = {};
			val[arguments[0]][arguments[1]] = arguments[2];
		}
		else if (arguments.length === 2) {
			// Called with ("type", selectors & callbacks)
			val = {};
			val[arguments[0]] = arguments[1];
		}

		var element = this;

		for (var type in val) {
			(function (type, callbacks) {
				element.addEventListener(type, function(evt) {
					for (var selector in callbacks) {
						if (evt.target.matches(selector)) { // Do ancestors count?
							callbacks[selector].call(this, evt);
						}
					}	
				});
			})(type, val[type]);
		}
	},
	
	// Set the contents as a string, an element, an object to create an element or an array of these
	contents: function (val) {
		if (val || val === 0) {
			(Array.isArray(val)? val : [val]).forEach(function (child) {
				if (/^(string|number|object)$/.test($.type(child))) {
					child = $.create(child);
				}
				
				if (child instanceof Node) {
					this.appendChild(child);
				}
			}, this);
		}
	},
	
	// Append the element inside another element
	inside: function (element) {
		element.appendChild(this);
	},
	
	// Insert the element before another element
	before: function (element) {
		element.parentNode.insertBefore(this, element);
	},
	
	// Insert the element after another element
	after: function (element) {
		element.parentNode.insertBefore(this, element.nextSibling);
	},
	
	// Insert the element before another element's contents
	start: function (element) {
		element.insertBefore(this, element.firstChild);
	},
	
	// Wrap the element around another element
	around: function (element) {
		if (element.parentNode) {
			$.before(this, element);
		}
		
		(/^template$/i.test(this.nodeName)? this.content || this : this).appendChild(element);
	}
};

$.Array = function (subject) {
	this.subject = subject;
};

// Extends Bliss with more methods

$.add = function (methods, on) {
	on = $.extend({$: true, element: true, array: true}, on);
	
	if ($.type(arguments[0]) === "string") {
		methods = {};
		methods[arguments[0]] = arguments[1];
	}
	
	for (var method in methods) {

		try {
			var callback = methods[method];
		}
		catch (e) {
			continue;
		}
		
		(function(method, callback){

		
		if ($.type(callback) == "function") {
			if (on.element) {
				var onElement = $.Element.prototype[method] = function () {
					return this.subject && $.defined(callback.apply(this.subject, arguments), this.subject);
				};
			}

			if (on.array) {
				var onArray = $.Array.prototype[method] = function() {
					var args = arguments;
					
					return this.subject.map(function(element) {
						return $.defined(callback.apply(element, args), element);
					});
				};
			}

			if (on.$) {
				$.sources[method] = callback;

				$[method] = function () {
					var args = [].slice.apply(arguments);
					var subject = args.shift();
					var callback = on.array && Array.isArray(subject)? onArray : onElement;

					return callback.apply({subject: subject}, args);
				}
			}
		}
		
		})(method, callback);
	}
};

$.add($.Element.prototype);
$.add($.setSpecial);
$.add(HTMLElement.prototype, {$: false});

})();
(function($) {
"use strict";

if (!Bliss || Bliss.shy) {
	return;
}

var _ = Bliss.property;

// Methods requiring Bliss Full
$.extend($.Element.prototype, {
	// Clone elements, with events
	clone: function () {
		var clone = this.cloneNode(true);
		var descendants = $.$("*", clone).concat(clone);

		$.$("*", this).concat(this).forEach(function(element, i, arr) {
			$.events(descendants[i], element);
		});

		return clone;
	},

	// Returns a promise that gets resolved after {type} has fired at least once
	waitFor: function(type) {
		if (this[$.property] && this[$.property].bliss.fired && this[$.property].bliss.fired[type] > 0) {
			// Already fired
			return Promise.resolve();
		}
		
		return new Promise(function(resolve, reject){
			$.once(type, function (evt) {
				resolve(evt);
			});
		});
	}
});

// Define the _ property on arrays and elements

Object.defineProperty(Node.prototype, _, {
	get: function () {
		Object.defineProperty(this, _, {
			value: new $.Element(this)
		});
		
		return this[_];
	},
	configurable: true
});

Object.defineProperty(Array.prototype, _, {
	get: function () {
		Object.defineProperty(this, _, {
			value: new $.Array(this)
		});
		
		return this[_];
	},
	configurable: true
});

// Hijack addEventListener and removeEventListener to store callbacks

if (self.EventTarget && "addEventListener" in EventTarget.prototype) {
	var addEventListener = EventTarget.prototype.addEventListener,
	    removeEventListener = EventTarget.prototype.removeEventListener,
	    filter = function(callback, capture, l){
	    	return !(l.callback === callback && l.capture == capture);
	    };

	EventTarget.prototype.addEventListener = function(type, callback, capture) {
		if (this[_]) {
			var listeners = this[_].bliss.listeners = this[_].bliss.listeners || {};
			
			listeners[type] = listeners[type] || [];

			var fired = this[_].bliss.fired = this[_].bliss.fired || {};
			fired[type] = fired[type] || 0;
			
			var oldCallback = callback;
			callback = function() {
				this[_].bliss.fired[type]++;

				return oldCallback.apply(this, arguments)
			};
			oldCallback.callback = callback;
			
			if (listeners[type].filter(filter.bind(null, callback, capture)).length === 0) {
				listeners[type].push({callback: oldCallback, capture: capture});
			}
		}

		return addEventListener.call(this, type, callback, capture);
	};

	EventTarget.prototype.removeEventListener = function(type, callback, capture) {
		if (this[_]) {
			var listeners = this[_].bliss.listeners = this[_].bliss.listeners || {};

			var oldCallback = callback;
			callback = oldCallback.callback;

			listeners[type] = listeners[type] || [];
			listeners[type] = listeners[type].filter(filter.bind(null, callback, capture));
		}

		return removeEventListener.call(this, type, callback, capture);
	};
}

// Set $ and $$ convenience methods, if not taken
self.$ = self.$ || $;
self.$$ = self.$$ || $.$;

})(Bliss);