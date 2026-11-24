import { Anime } from '../Anime.js';
import './proto/FilterProto.js';

class FilterColorMatrix extends PIXI.filters.ColorMatrixFilter {
	constructor(params) {
		super();
		this._handlerOrder = [];
		this._handlerFunctions = {};
		this._handlerArgs = {};
		this._values = { matrix: this.identity.slice() };
		
		// So here's the deal:
		// The Pixi version that Foundry currently uses calls _colorMatrix
		// after each multiplication, but this loses Offsets from previous matrices.
		// At once, all of the helper functions use non-normalized offsets,
		// so we need to normalize matrices that those pass to _loadMatrix.
		this._normalizeMatrix = this._colorMatrix;
		this._colorMatrix = (m) => [...m];
		this._loadMatrix__normalize = false;
		this._loadMatrix__base = this._loadMatrix;
		this._loadMatrix = (m, multiply) => {
			if (this._loadMatrix__normalize) m = this._normalizeMatrix(m);
			this._loadMatrix__base(m, multiply);
		}
		const bindNormalize = (func) => {
			func = func.bind(this);
			return (...args) => {
				const prevNormalize = this._loadMatrix__normalize;
				this._loadMatrix__normalize = true;
				func(...args);
				this._loadMatrix__normalize = prevNormalize;
			}
		}
		
		//
		this.hookedProperties = {};
		const hookArg = (name) => {
			if (this.hookedProperties[name]) return;
			this.hookedProperties[name] = true;
			Object.defineProperty(this, name, {
				get() { return this._values[name] },
				set(value) {
					this._values[name] = value;
					this.sync();
				}
			});
		}
		
		// when assigning custom {handlers} into order, we want to listen to changes on their arguments
		Object.defineProperty(this, "order", {
			get() { return this._handlerOrder },
			set(value) {
				if (!Array.isArray(value)) value = [];
				for (let pair of value) {
					if (pair == null || typeof(pair) !== "object") continue;
					if (pair.arg) hookArg(pair.arg);
					if (Array.isArray(pair.args)) {
						for (let arg of pair.args) {
							if (typeof(arg) === "string") hookArg(arg);
						}
					}
				}
				this._handlerOrder = value;
			}
		});
		
		//
		let addProp_autoNormalize = false;
		const addProp = (name, func, args) => {
			if (addProp_autoNormalize) {
				func = bindNormalize(func);
			} else func = func.bind(this);
			this.order.push(name);
			this._handlerFunctions[name] = func;
			this._handlerArgs[name] = args;
			for (let arg of args) hookArg(arg);
		}
		const addProp1 = (name, func) => {
			addProp(name, func, [name]);
		}
		const addProp0 = (name, func) => {
			func = func.bind(this);
			addProp1(name, (run, multiply) => {
				if (run) func(multiply);
			})
		}
		const addAlias = (name, target) => {
			Object.defineProperty(this, name, {
				get() { return this[target] },
				set(value) { this[target] = value }
			})
		}
		addProp1("matrix", (m, multiply) => {
			m = this._colorMatrix(m);
			this._loadMatrix(m, multiply);
		});
		addProp_autoNormalize = true;
		
		//
		addProp1("blackAndWhite", this.blackAndWhite);
		addProp1("brightness", this.brightness);
		addProp0("browni", this.browni);
		// todo: colorTone? Does anyone want it?
		addProp1("contrast", this.contrast);
		addProp0("desaturate", (multiply) => {
			this._handlerFunctions.saturate(-1, multiply);
		});
		addProp1("greyscale", this.greyscale);
		addAlias("grayscale", "greyscale");
		addProp1("hue", this.hue);
		addProp0("kodachrome", this.kodachrome);
		addProp0("lsd", this.lsd);
		addProp0("negative", this.negative);
		addProp1("night", this.night);
		addProp0("polaroid", this.polaroid);
		addProp1("predator", this.predator);
		addProp1("saturate", this.saturate);
		addProp0("sepia", this.sepia);
		addProp0("technicolor", this.technicolor);
		addProp1("tint", this.tint);
		addProp0("toBGR", this.toBGR);
		addProp0("vintage", this.vintage);
		// and now the helpers like rr-rg-rb-rw-gr-...
		for (let y = 0; y < 4; y++) {
			for (let x = 0; x < 5; x++) {
				let prop = "rgba"[y] + "rgbaw"[x];
				let index = y * 5 + x;
				Object.defineProperty(this, prop, {
					get() { return this._values.matrix[index] },
					set(value) {
						this._values.matrix[index] = value;
						this.sync();
					}
				})
			}
		}
		
		//
		this.zOrder = 10;
		this.animated = {};
		this.noSync = true;
		this.setTMParams(params);
		if (!this.dummy) {
			this.anime = new Anime(this);
			this.normalizeTMParams();
		}
		this.noSync = false;
		this.sync();
	}
	identity = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
	sync() {
		if (this.noSync) return;
		for (let i = 0; i < 20; i++) {
			this.uniforms.m[i] = this.identity[i];
		}
		let multiply = false;
		const fetchArg = (arg) => this._values[arg] ?? this[arg];
		for (let o of this._handlerOrder) {
			let func, funcArgs, funcArg;
			if (typeof(o) === "string") {
				func = this._handlerFunctions[o];
				funcArgs = this._handlerArgs[o];
				funcArg = o;
			} else if (typeof(o) === "object") {
				func = this._handlerFunctions[o.type] ?? this[o.type];
				funcArgs = o.args;
				funcArg = o.arg;
			} else continue;
			if (!func || (!funcArgs && !funcArg)) continue;
			
			// validate arguments:
			let invalidArgs = false;
			if (!funcArgs) {
				let arg = funcArg;
				if (typeof(arg) === "string") arg = fetchArg(arg);
				if (arg == null) invalidArgs = true;
			} else for (let arg of funcArgs) {
				if (typeof(arg) === "string") arg = fetchArg(arg);
				if (arg == null) invalidArgs = true;
			}
			if (invalidArgs) {
				//console.warn(this, "has invalid arguments:", args);
				continue;
			}
			
			// gather arguments:
			let args = [];
			if (!funcArgs) {
				let arg = funcArg;
				if (typeof(arg) === "string") arg = fetchArg(arg);
				args.push(arg);
			} else for (let arg of funcArgs) {
				if (typeof(arg) === "string") arg = fetchArg(arg);
				args.push(arg);
			}
			
			//console.log(i, o, args);
			func(...args, multiply);
			multiply = true; // use `multiply: true` for all but the first func
		}
	}
}