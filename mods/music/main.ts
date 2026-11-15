import ModBase from "../../lib/modbase.js";
import fs from "fs";
import path from "path";
import { parseMidi } from "midi-file";

// MIDI 解析工具函数

const MAIN_VOL_FACTOR = 0.9;
const SUB_VOL_FACTOR = 0.7;

// 文件名合法性校验（路径穿越防护）
// 拒绝含路径分隔符、以 . 开头（含 ..）或过长的文件名
function sanitizeMusicName(fileName) {
	if (typeof fileName !== "string" || !fileName) return null;
	if (fileName.length > 100) return null;
	if (fileName !== path.basename(fileName)) return null; // 含目录成分
	if (/[\\/]/.test(fileName)) return null; // 路径分隔符
	if (fileName.startsWith(".")) return null; // . .. .hidden
	return fileName;
}

function getSoundString(program, percussion = false) {
	if (!percussion) {
		if ([105].includes(program)) return 'note.banjo';
		if ([32, 33, 34, 35, 36, 37, 38, 39].includes(program)) return 'note.bass';
		if ([115, 116, 117, 118].includes(program)) return 'note.basedrum';
		if ([9].includes(program)) return 'note.bell';
		if ([80, 81].includes(program)) return 'note.bit';
		if ([112].includes(program)) return 'note.cow_bell';
		if ([72, 73, 74, 75, 76, 77, 78, 79, 41, 42, 43, 44].includes(program)) return 'note.flute';
		if ([24, 25, 26, 27, 28, 29, 30, 31].includes(program)) return 'note.guitar';
		if ([14].includes(program)) return 'note.chime';
		if ([8, 9, 10, 11, 12, 13, 15].includes(program)) return 'note.iron_xylophone';
		if ([2].includes(program)) return 'note.pling';
		return 'note.harp';
	} else {
		if ([55].includes(program)) return 'note.cow_bell';
		if ([41, 43, 45].includes(program)) return 'note.hat';
		if ([36, 37, 39].includes(program)) return 'note.snare';
		return 'note.bd';
	}
}

function mapInstrument(channel, program, note) {
	if (channel === 9 || channel === 10) {
		return getSoundString(note, true);
	}
	return getSoundString(program, false);
}

function midiToMinecraftPitch(midiNote) {
	if (midiNote < 0 || midiNote > 127) return 1.0;
	const semitoneOffset = midiNote - 66;
	return Math.pow(2, semitoneOffset / 12);
}

function parseMidiFile(filePath, fileName, playPercussion) {
	const rawData = fs.readFileSync(filePath);
	const midi = parseMidi(rawData);
	if (!midi || !midi.tracks) throw new Error('无法解析 MIDI 文件');

	let ppq = midi.header.ticksPerBeat || 480;
	if (typeof ppq !== 'number' || ppq <= 0) throw new Error(`无效的 PPQ 值: ${ppq}`);

	let currentTempo = 500000;
	let notes = [];
	const channelPrograms = {};

	midi.tracks.forEach((track, trackIdx) => {
		let timeSec = 0;
		let ticks = 0;

		for (const event of track) {
			const deltaTicks = event.deltaTime || 0;
			ticks += deltaTicks;
			const deltaSec = (deltaTicks / ppq) * (currentTempo / 1000000);
			timeSec += deltaSec;

			if (event.type === 'noteOn' && event.velocity > 0) {
				const channel = event.channel;
				const note = event.noteNumber;
				const velocity = event.velocity;

				const volumeFactor = (channel === 0) ? MAIN_VOL_FACTOR : SUB_VOL_FACTOR;
				const volume = Number((velocity / 100 * volumeFactor).toFixed(5));

				if ((channel === 9 || channel === 10) && !playPercussion) continue;

				const pitch = midiToMinecraftPitch(note);
				const programKey = `${trackIdx}-${channel}`;
				const program = channelPrograms[programKey] || 0;
				const instrument = mapInstrument(channel, program, note);

				notes.push({
					time: Number(timeSec.toFixed(3)),
					instrument,
					volume,
					pitch: Number(pitch.toFixed(5))
				});
			} else if (event.type === 'programChange') {
				const programKey = `${trackIdx}-${event.channel}`;
				channelPrograms[programKey] = event.programNumber;
			} else if (event.type === 'setTempo') {
				currentTempo = event.microsecondsPerBeat;
			}
		}
	});

	notes.sort((a, b) => a.time - b.time);
	const firstTime = notes.length > 0 ? notes[0].time : 0;
	const trackArray = notes.map(n => [
		Number((n.time - firstTime).toFixed(3)),
		n.instrument,
		n.volume,
		n.pitch
	]);

	const titleWithoutExt = fileName.replace(/\.[^/.]+$/, '');
	return {
		title: titleWithoutExt,
		tracks: trackArray
	};
}

// MusicDisplay 类

export default class MusicDisplay extends ModBase {
	constructor(client) {
		super();
		this.client = client;
		this.title = null;
		this.tracks = null;
		this.resolveRef = null;
		this.timeout = null;
		this.files = [];
		this.index = 0;
		this.progress = 0;
		this.running = false;
		this.looping = false;
		this.loopMode = null;
		this._filesCacheTime = 0;
		this.playPercussion = (this.constructor as typeof MusicDisplay).config?.features?.music?.playPercussion ?? true;
	}

	onCommand() {
		return {
			normal: [
this.Command.create("m:join", this.rawtext("music.msg.f4778c2d3f"))
				.setFunc((commander) => {
					this.client.sendCommand(`tag @a[name="${commander}"] remove non-listener`);
					this.client.tell(this.rawtext("music.msg.031bf5fec2"), commander);
				}),

this.Command.create("m:exit", this.rawtext("music.msg.25fe0410be"))
				.setFunc((commander) => {
					this.client.sendCommand(`tag @a[name="${commander}"] add non-listener`);
					this.client.tell(this.rawtext("music.msg.58fa1dc7c7"), commander);
				}),

this.Command.create("m:status", this.rawtext("music.msg.14005e91b7"))
				.setFunc((commander) => {
					this.status(commander);
				}),

this.Command.create("m:list", this.rawtext("music.msg.90b1716840"))
				.addOptionalInteger(this.rawtext("music.param.7b0930e205"))
				.setFunc(async (commander, page) => {
					await this.show(10, page, commander);
				}),

this.Command.create("m:search", this.rawtext("music.msg.16f6387e73"))
				.addString(this.rawtext("music.param.cc1b21e800"), false)
				.addOptionalInteger(this.rawtext("music.param.7b0930e205"))
				.setFunc(async (commander, keyword, page) => {
					await this.search(keyword, 10, page, commander);
				}),

this.Command.create("m:percussion", this.rawtext("music.msg.8572b677ca"))
				.addEnum(["on", "off"], this.rawtext("music.msg.59106563f8"))
				.setFunc((commander, mode) => {
					this.playPercussion = mode === "on";
					this.client.tell(this.rawtext("music.msg.c5e9b6b66d", { p0: this.playPercussion ? "开启" : "关闭" }), commander);
				})
			],

			user: [
this.Command.create("m:run", this.rawtext("music.msg.3ab9be074c"))
				.addString(this.rawtext("music.param.983770e129"))
				.setFunc((_, fileName) => {
					this.fastrun(fileName);
				}),

this.Command.create("m:next", this.rawtext("music.msg.9c717e3b82"))
				.setFunc((_) => {
					this.next();
				}),

this.Command.create("m:random", this.rawtext("music.msg.80b8afeadd"))
				.setFunc((_) => {
					this.random();
				}),

this.Command.create("m:loop", this.rawtext("music.msg.ca2222eac7"))
				.addEnum(["next", "random", "single"], this.rawtext("music.msg.2be9eb9243"))
				.addOptionalString(this.rawtext("music.param.5012ab48b2"))
				.setFunc((commander, mode, fileName) => {
					if (mode === "single") {
						if (fileName) this.fastrun(fileName);
						else this.singleLoop();
					} else {
						if (fileName) {
							this.client.tell(this.rawtext("music.msg.50aaf42acf"), commander);
							return;
						}
						if (mode === "next") this.nextLoop();
						if (mode === "random") this.randomLoop();
					}
				}),

this.Command.create("m:stop", this.rawtext("music.msg.a0b1c82732"))
				.addOptionalEnum(["music", "loop", "all"], this.rawtext("music.msg.8fa8b57743"))
				.setFunc((_, mode) => {
					if (mode === undefined || mode === "all") this.stopAll();
					if (mode === "music") this.stop();
					if (mode === "loop") this.stopLoop();
				})
			]
		};
	}

	set(number) {
		if (typeof number == "number") {
			this.index = number;
			return true;
		}
		if (typeof number == "string" && /^[-+]?\d+$/.test(number)) {
			this.index = parseInt(number);
			return true;
		}
		return false;
	}

	get() {
		return new Promise<void>((resolve, reject) => {
			fs.readdir(this.config.basePath, (error, files) => {
				if (error) {
					this.client.tell(this.rawtext("music.msg.f8d464677d", { p0: error }));
					reject(new Error("目录获取失败"));
					return;
				}
				// 过滤 .json 和 .mid 文件，按文件名去重（优先保留 .json）
				const musicFiles = files.filter(f => /\.(json|mid)$/i.test(f));
				const nameMap = new Map();
				for (const file of musicFiles) {
					const baseName = file.replace(/\.(json|mid)$/i, "");
					if (!nameMap.has(baseName)) {
						nameMap.set(baseName, file);
					} else {
						const existing = nameMap.get(baseName);
						if (existing.endsWith(".mid") && file.endsWith(".json")) {
							nameMap.set(baseName, file);
						}
					}
				}
				// 排序：readdir 返回顺序由文件系统决定，若不排序会导致 m:list 顺序每次不同（显示错乱）
				this.files = [...nameMap.values()].sort((a, b) =>
					a.replace(/\.(json|mid)$/i, "").localeCompare(b.replace(/\.(json|mid)$/i, ""))
				);
				this._filesCacheTime = Date.now();
				this.reset();
				resolve();
			});
		});
	}

	async safeget() {
		const now = Date.now();
		if (this.files.length > 0 && (now - this._filesCacheTime) < 30000) {
			return true;
		}
		try {
			await this.get();
			return true;
		} catch {
			return false;
		}
	}

	async test() {
		if (!this.files || this.files.length === 0) await this.safeget();
		if (this.index >= 0 && this.index < this.files.length) return true;
		return false;
	}

	reset() {
		this.set(0);
	}

	load(fileName) {
		return new Promise<string>((resolve, reject) => {
			// 路径穿越防护：只允许单层合法文件名
			const safeName = sanitizeMusicName(fileName);
			if (!safeName) {
				this.client.tell(this.rawtext("music.msg.714141c923", { p0: fileName }));
				reject(new Error("非法的文件名"));
				return;
			}
			fileName = safeName;

			let filePath;
			if (fileName.endsWith(".json") || fileName.endsWith(".mid")) {
				filePath = path.join(this.config.basePath, fileName);
			} else {
				const jsonPath = path.join(this.config.basePath, fileName + ".json");
				const midPath = path.join(this.config.basePath, fileName + ".mid");
				if (fs.existsSync(jsonPath)) {
					filePath = jsonPath;
				} else if (fs.existsSync(midPath)) {
					filePath = midPath;
				} else {
					filePath = jsonPath;
				}
			}

			const ext = path.extname(filePath).toLowerCase();

			if (ext === ".mid") {
				try {
					const data = parseMidiFile(filePath, path.basename(filePath), this.playPercussion);
					this.title = data.title;
					this.tracks = data.tracks;
					resolve("音乐加载成功");
				} catch (error) {
					this.client.tell(`§cMusic | §fError > §i${this.rawtext("error.midi")}`);
					reject(new Error("MIDI 加载失败"));
				}
			} else {
				fs.readFile(filePath, "utf-8", (error, file) => {
					if (error) {
						this.client.tell(this.rawtext("music.msg.b24d42c6c8", { p0: error }));
						reject(new Error("音乐加载失败"));
						return;
					}
					try {
						const data = JSON.parse(file);
						this.title = data?.title;
						this.tracks = data?.tracks;
						resolve("音乐加载成功");
					} catch (parseError) {
						this.client.tell(`§cMusic | §fError > §i${this.rawtext("error.json")}`);
						reject(new Error("JSON 解析失败"));
					}
				});
			}
		});
	}

	stop() {
		if (!this.running) {
			this.client.tell(this.rawtext("music.msg.ba96112421"));
			return;
		}
		clearTimeout(this.timeout);
		this.timeout = null;
		if (this.resolveRef) {
			this.resolveRef();
			this.resolveRef = null;
		}
		this.running = false;
		this.client.tell(this.rawtext("music.msg.5dfe26fee3"));
	}

	async run() {
		if (!this.title || !this.tracks) {
			this.client.tell(this.rawtext("music.msg.76ceabb6ba"));
			return;
		}
		if (this.running) {
			this.client.tell(this.rawtext("music.msg.f103429ebf"));
			return;
		}

		this.running = true;
		this.client.tell(this.rawtext("music.msg.7b430dcedf", { p0: this.title }));

		const startTime = Date.now() / 1000;

		try {
			for (const track of this.tracks) {
				if (!this.running) return;

				const [time, timbre, volume, pitch] = track;

				let nowTime = Date.now() / 1000;
				let sleepTime = time - (nowTime - startTime);

				if (sleepTime > 0) {
					await new Promise<void>((resolve) => {
						this.resolveRef = resolve;
						this.timeout = setTimeout(() => resolve(), sleepTime * 1000);
					});
					this.timeout = null;
					this.resolveRef = null;
				}

				if (sleepTime < -1) this.client.tell(this.rawtext("music.msg.0d34a80f76", { p0: sleepTime }));
				if (!this.running) return;

				this.client.sendCommand(`/execute as @a[tag=!non-listener] at @s run playsound ${timbre} @s ~ ~ ~ ${volume} ${pitch}`);
				this.progress += 1;
			}
			this.client.tell(this.rawtext("music.msg.d9cc38fab2", { p0: this.title }));
			this.progress = 0;
		} catch (error) {
			this.client.tell(this.rawtext("music.msg.49ef9817d8", { p0: error }));
		} finally {
			this.running = false;
		}
	}

	async fastrun(fileName) {
		try {
			await this.load(fileName);
			await this.run();
		} catch {
			return;
		}
	}

	async indexrun(number = this.index) {
		if (!this.set(number)) {
			this.client.tell(this.rawtext("music.msg.3ff791b7d0"));
			return false;
		}
		if (!(await this.test())) {
			this.client.tell(this.rawtext("music.msg.265d0bb0af"));
			return false;
		}
		await this.fastrun(this.files[this.index]);
		return true;
	}

	async next() {
		if (!(await this.test())) {
			this.client.tell(this.rawtext("music.msg.265d0bb0af"));
			return false;
		}
		// 先推进到下一首再播放（与命令描述"切换到下一首"一致）
		this.index = (this.index + 1) % this.files.length;
		// 播放中切换需先停止当前歌曲，否则 run() 会因 running 直接返回
		if (this.running) this.stop();
		await this.indexrun();
		return true;
	}

	async random() {
		await this.safeget();
		if (this.files.length === 0) {
			this.client.tell(this.rawtext("music.msg.be055f6b5e"));
			return;
		}
		this.index = Math.floor(Math.random() * this.files.length);
		// 播放中切换需先停止当前歌曲
		if (this.running) this.stop();
		await this.indexrun();
	}

	sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	_validateLoopTime(time) {
		if (!(typeof time == "string" && /^[-+]?\d+$/.test(time)) && typeof time != "number") {
			this.client.tell(this.rawtext("music.msg.550409daa1"));
			return false;
		}
		return true;
	}

	async startLoop(mode, time = 5) {
		if (this.looping) {
			this.client.tell(this.rawtext("music.msg.cb0c8391f0"));
			return;
		}
		if (!this._validateLoopTime(time)) return;

		if (mode === "single" && (!this.title || !this.tracks)) {
			this.client.tell(this.rawtext("music.msg.2c4ed3f5f9"));
			return;
		}

		const intTime = Number(time) * 1000;
		const modeLabels = { next: "顺序循环", random: "随机循环", single: "单曲循环" };
		const modeLabel = modeLabels[mode];
		const displayTitle = mode === "single" ? ` ${this.title}` : "";
		this.client.tell(this.rawtext("music.msg.09f7b2e7a8", { p0: modeLabel, p1: displayTitle }));

		this.looping = true;
		this.loopMode = mode;

		while (this.looping) {
			if (mode === "next") await this.next();
			else if (mode === "random") await this.random();
			else if (mode === "single") await this.run();
			if (!this.looping) break;
			await this.sleep(intTime);
		}
	}

	async nextLoop(time = 5) { return this.startLoop("next", time); }
	async randomLoop(time = 5) { return this.startLoop("random", time); }
	async singleLoop(time = 5) { return this.startLoop("single", time); }

	stopLoop() {
		if (this.looping) {
			this.looping = false;
			this.loopMode = null;
			this.client.tell(this.rawtext("music.msg.947214a99b"));
		} else {
			this.client.tell(this.rawtext("music.msg.ac2aa7c344"));
		}
	}

	stopAll() {
		if (this.looping) this.stopLoop();
		if (this.running) this.stop();
	}

	status(cmder="@a") {
		if (!this.running) {
			this.client.tell(this.rawtext("music.msg.919b47ca7b"));
			return;
		}
		this.client.tell(this.rawtext("music.msg.ad7105e7fa", { p0: this.title, p1: this.progress, p2: this.tracks.length }), cmder);
	}

	async show(pageSize, pageNumber, cmder = null) {
		await this.safeget();
		if (this.files.length === 0) {
			this.client.tell(this.rawtext("music.msg.be055f6b5e"), cmder);
			return [];
		}

		const totalPages = Math.ceil(this.files.length / pageSize);
		if (!pageNumber || pageNumber < 1) pageNumber = 1;
		if (pageNumber > totalPages) pageNumber = totalPages;

		const startIndex = (pageNumber - 1) * pageSize;
		const endIndex = startIndex + pageSize;
		const pageFiles = this.files.slice(startIndex, endIndex);

		const header = `§eMusic | §fList > §i第${pageNumber}/${totalPages}页 共 ${this.files.length} 首`;
		const items = pageFiles.map((f, i) => {
			const name = f.replace(/\.(json|mid)$/i, "");
			const num = String(startIndex + i + 1).padStart(2, " ");
			const filePath = path.join(this.config.basePath, f);
			let size = "?";
			try {
				const stats = fs.statSync(filePath);
				size = this.formatSize(stats.size);
			} catch {}
			return `${num}. §b${name} §f${size}`;
		}).join("\n");

		this.client.tell(`${header}\n${items}`, cmder);
		return pageFiles;
	}

	async search(keyword, pageSize = 10, pageNumber = 1, cmder = null) {
		await this.safeget();
		if (this.files.length === 0) {
			this.client.tell(this.rawtext("music.msg.be055f6b5e"), cmder);
			return;
		}

		const lowerKeyword = keyword.toLowerCase();
		const matched = this.files.filter(f => f.toLowerCase().includes(lowerKeyword));

		if (matched.length === 0) {
			this.client.tell(this.rawtext("music.msg.7a364198b6", { p0: keyword }), cmder);
			return;
		}

		const totalPages = Math.ceil(matched.length / pageSize);
		if (!pageNumber || pageNumber < 1) pageNumber = 1;
		if (pageNumber > totalPages) pageNumber = totalPages;

		const startIndex = (pageNumber - 1) * pageSize;
		const endIndex = startIndex + pageSize;
		const pageFiles = matched.slice(startIndex, endIndex);

		const header = `§eMusic | §fSearch > §i"${keyword}" 第${pageNumber}/${totalPages}页 共 ${matched.length} 首`;
		const items = pageFiles.map((f, i) => {
			const name = f.replace(/\.(json|mid)$/i, "");
			const num = String(startIndex + i + 1).padStart(2, " ");
			const filePath = path.join(this.config.basePath, f);
			let size = "?";
			try {
				const stats = fs.statSync(filePath);
				size = this.formatSize(stats.size);
			} catch {}
			return `${num}. ${name} §f${size}`;
		}).join("\n");

		this.client.tell(`${header}\n${items}`, cmder);
	}

	formatSize(bytes) {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}

	onDestroy() {
		this.stopAll();
		this.client = null;
		this.title = null;
		this.tracks = null;
		this.files = [];
		this.index = 0;
		this.loopMode = null;
	}
}
