// 轻量 Markdown 渲染器
// 用途：把第三方 Mod 的 README.md 渲染进 WebUI（经 v-html 注入）。
//
// 安全约定：只输出本文件生成的标签，所有来自文档的文本都必须先经 escapeHtml，
// 链接/图片 URL 还必须先经 sanitizeUrl，因此渲染结果是 XSS 安全的。
//
// 支持：标题、围栏代码块（含列表项内缩进围栏）、行内代码、粗体/斜体/删除线、
//       有序/无序列表（含嵌套与续行）、GFM 表格、引用块、分隔线、段落、链接与图片、自动链接。

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// 只放行安全协议，拦掉 javascript: / data: / vbscript: 等
export function sanitizeUrl(url) {
	const raw = String(url ?? "").trim();
	if (!raw) return "";
	// 去掉控制字符后再判断，避免 "java\nscript:" 这类绕过
	const compact = raw.replace(/[\u0000-\u001f\u007f]/g, "");
	if (!compact) return "";
	const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/i);
	if (scheme && !/^(?:https?|mailto|ftp|tel)$/i.test(scheme[1])) return "";
	return compact;
}

// ---------- 行内 ----------

const CODE_SPAN_RE = /(^|[^`])(`+)([^`]|[^`][\s\S]*?[^`])\2(?!`)/g;
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^\s)]*)(?:\s+"([^"]*)")?\s*\)/g;
const LINK_RE = /\[([^\]]*)\]\(\s*([^\s)]*)(?:\s+"([^"]*)")?\s*\)/g;
const AUTOLINK_RE = /<((?:https?|mailto):[^<>\s]+)>/g;

function renderInline(text) {
	const stash = [];
	const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
	let out = String(text ?? "");

	// 1) 行内代码先摘出，避免 `` `**x**` `` 之类被强调规则破坏
	out = out.replace(CODE_SPAN_RE, (m, lead, ticks, code) => {
		// 去掉 CommonMark 规定的首尾各一个空格
		const trimmed = /^ .* $/.test(code) ? code.slice(1, -1) : code;
		return lead + keep(`<code>${escapeHtml(trimmed)}</code>`);
	});

	// 2) 图片与链接（URL 先做协议白名单，危险 URL 原样保留文本）
	out = out.replace(IMAGE_RE, (m, alt, url, title) => {
		const src = sanitizeUrl(url);
		if (!src) return m;
		const t = title ? ` title="${escapeHtml(title)}"` : "";
		return keep(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${t} loading="lazy">`);
	});
	out = out.replace(LINK_RE, (m, label, url, title) => {
		const href = sanitizeUrl(url);
		if (!href) return m;
		const t = title ? ` title="${escapeHtml(title)}"` : "";
		return keep(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${t}>${renderInline(label)}</a>`);
	});
	out = out.replace(AUTOLINK_RE, (m, url) => {
		const href = sanitizeUrl(url);
		if (!href) return m;
		return keep(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`);
	});

	// 3) 其余文本统一转义（占位符 \u0000N\u0000 不受影响）
	out = escapeHtml(out);

	// 4) 强调（此时文本已转义，* _ ~ 仍然存在）
	out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
	out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
	out = out.replace(/(^|[^\w])__([^_\n]+)__(?!\w)/g, "$1<strong>$2</strong>");
	out = out.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
	out = out.replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
	out = out.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

	// 5) 还原占位符
	return out.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[Number(i)] ?? "");
}

// ---------- 块级 ----------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9#+._-]*)[ \t]*$/;
const FENCE_END_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const ITEM_RE = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const QUOTE_RE = /^ {0,3}>/;
const TABLE_DELIM_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const indentOf = (line) => (line.match(/^ */) || [""])[0].length;

function isBlockStart(line) {
	return (
		FENCE_RE.test(line) ||
		HEADING_RE.test(line) ||
		HR_RE.test(line) ||
		ITEM_RE.test(line) ||
		QUOTE_RE.test(line)
	);
}

// 收集围栏代码块内容；返回 [code, nextIndex, lang]
function readFence(lines, start) {
	const open = lines[start].match(FENCE_RE);
	const marker = open[1][0];
	const minLen = open[1].length;
	const lang = open[2] || "";
	const indent = indentOf(lines[start]);
	const body = [];
	let i = start + 1;
	while (i < lines.length) {
		const close = lines[i].match(FENCE_END_RE);
		if (close && close[1][0] === marker && close[1].length >= minLen) {
			i++;
			break;
		}
		// 去掉围栏自身的缩进（支持缩进在列表项里的代码块）
		body.push(indent > 0 ? lines[i].slice(Math.min(indent, indentOf(lines[i]))) : lines[i]);
		i++;
	}
	return [body.join("\n"), i, lang];
}

function codeBlockHtml(code, lang) {
	const cls = lang ? ` class="language-${escapeHtml(lang.toLowerCase())}"` : "";
	return `<pre><code${cls}>${escapeHtml(code)}${code ? "\n" : ""}</code></pre>`;
}

// 按未转义且不在行内代码中的 | 切分；首尾竖线产生的空单元格会被丢掉
function splitRow(line) {
	const cells = [];
	let buf = "";
	let codeTicks = 0; // 0 = 不在行内代码中，否则为打开它的反引号个数
	let escaped = false;
	const push = () => { cells.push(buf.trim()); buf = ""; };

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (escaped) { buf += ch; escaped = false; continue; }
		if (ch === "\\") { escaped = true; buf += ch; continue; }
		if (ch === "`") {
			let run = 1;
			while (line[i + run] === "`") run++;
			if (codeTicks === 0) codeTicks = run;
			else if (codeTicks === run) codeTicks = 0;
			buf += "`".repeat(run);
			i += run - 1;
			continue;
		}
		if (ch === "|" && codeTicks === 0) { push(); continue; }
		buf += ch;
	}
	push();

	if (cells.length > 1 && cells[0] === "") cells.shift();
	if (cells.length > 1 && cells[cells.length - 1] === "") cells.pop();
	return cells;
}

function renderTable(lines, start) {
	const header = splitRow(lines[start]);
	const aligns = splitRow(lines[start + 1]).map((c) => {
		const left = c.startsWith(":");
		const right = c.endsWith(":");
		return left && right ? "center" : right ? "right" : left ? "left" : "";
	});
	const alignAttr = (i) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : "");

	let i = start + 2;
	const rows = [];
	while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
		rows.push(splitRow(lines[i]));
		i++;
	}

	let html = "<table><thead><tr>";
	header.forEach((cell, idx) => {
		html += `<th${alignAttr(idx)}>${renderInline(cell)}</th>`;
	});
	html += "</tr></thead>";
	if (rows.length) {
		html += "<tbody>";
		for (const row of rows) {
			html += "<tr>";
			const width = Math.max(header.length, row.length);
			for (let c = 0; c < width; c++) {
				// 单元格里的 \| 视作字面竖线
				html += `<td${alignAttr(c)}>${renderInline((row[c] ?? "").replace(/\\\|/g, "|"))}</td>`;
			}
			html += "</tr>";
		}
		html += "</tbody>";
	}
	html += "</table>";
	return [html, i];
}

// 列表：支持嵌套（按缩进）与续行，嵌套列表会被放进上一个 <li> 内
function renderList(lines, start, baseIndent) {
	const ordered = /\d/.test(lines[start].match(ITEM_RE)[2]);
	const tag = ordered ? "ol" : "ul";
	let html = `<${tag}>`;
	let open = false;
	let i = start;

	while (i < lines.length) {
		const m = lines[i].match(ITEM_RE);
		if (!m) break;
		const indent = m[1].length;
		if (indent < baseIndent) break;

		if (indent > baseIndent) {
			if (!open) break;
			const [sub, next] = renderList(lines, i, indent);
			html += sub;
			i = next;
			continue;
		}

		if (/\d/.test(m[2]) !== ordered) break;

		if (open) html += "</li>";
		html += `<li>${renderInline(m[3])}`;
		open = true;
		i++;

		// 续行与列表项内的代码块
		while (i < lines.length) {
			const line = lines[i];
			if (!line.trim() || ITEM_RE.test(line) || indentOf(line) <= baseIndent) break;
			const fence = line.match(FENCE_RE);
			if (fence) {
				const [code, next, lang] = readFence(lines, i);
				html += codeBlockHtml(code, lang);
				i = next;
				continue;
			}
			html += `<br>${renderInline(line.trim())}`;
			i++;
		}
	}

	if (open) html += "</li>";
	html += `</${tag}>`;
	return [html, i];
}

export function renderMarkdown(source) {
	const lines = String(source ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/\t/g, "    ")
		.replace(/^\uFEFF/, "")
		.split("\n");

	const out = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}

		if (FENCE_RE.test(line)) {
			const [code, next, lang] = readFence(lines, i);
			out.push(codeBlockHtml(code, lang));
			i = next;
			continue;
		}

		if (HR_RE.test(line)) {
			out.push("<hr>");
			i++;
			continue;
		}

		const heading = line.match(HEADING_RE);
		if (heading) {
			const level = heading[1].length;
			out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
			i++;
			continue;
		}

		// GFM 表格：当前行有 |，下一行是分隔行
		if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && TABLE_DELIM_RE.test(lines[i + 1])) {
			const [html, next] = renderTable(lines, i);
			out.push(html);
			i = next;
			continue;
		}

		if (QUOTE_RE.test(line)) {
			const buf = [];
			while (i < lines.length && lines[i].trim()) {
				if (!QUOTE_RE.test(lines[i])) break;
				buf.push(lines[i].replace(/^ {0,3}> ?/, ""));
				i++;
			}
			out.push(`<blockquote>${renderMarkdown(buf.join("\n"))}</blockquote>`);
			continue;
		}

		if (ITEM_RE.test(line)) {
			const [html, next] = renderList(lines, i, indentOf(line));
			out.push(html);
			i = next < i ? i + 1 : next;
			continue;
		}

		// 段落：连续的非空、非块起始行合并
		const para = [];
		while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
			para.push(lines[i].trim());
			i++;
		}
		if (para.length) {
			out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
		} else {
			i++; // 兜底，绝不死循环
		}
	}

	return out.join("\n");
}

export default renderMarkdown;
