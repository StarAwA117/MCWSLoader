// 简易 multipart/form-data 解析器，仅用于 mod 导入场景

const CR = 0x0d;
const LF = 0x0a;
const DASH = 0x2d;

function parseMultipart(buffer, boundary) {
	const results = {};
	const marker = Buffer.from("--" + boundary, "latin1");

	// 找出所有「行首」的 boundary 位置（行首或 CRLF 之后），避免误匹配二进制内容
	const offsets = [];
	let searchFrom = 0;
	while (searchFrom <= buffer.length - marker.length) {
		const found = buffer.indexOf(marker, searchFrom);
		if (found === -1) break;
		const atLineStart = found === 0 || (found >= 2 && buffer[found - 2] === CR && buffer[found - 1] === LF);
		if (atLineStart) {
			offsets.push(found);
			searchFrom = found + marker.length;
		} else {
			searchFrom = found + 1;
		}
	}

	for (let i = 0; i < offsets.length - 1; i++) {
		let start = offsets[i] + marker.length;
		// 结束标记 "--boundary--"，没有后续内容
		if (buffer[start] === DASH && buffer[start + 1] === DASH) continue;
		if (buffer[start] === CR && buffer[start + 1] === LF) start += 2;

		let end = offsets[i + 1];
		if (end >= 2 && buffer[end - 2] === CR && buffer[end - 1] === LF) end -= 2;

		const part = buffer.slice(start, end);
		const headerEnd = part.indexOf("\r\n\r\n");
		if (headerEnd === -1) continue;

		const headerBlock = part.slice(0, headerEnd).toString("utf8");
		const content = part.slice(headerEnd + 4);

		const nameMatch = headerBlock.match(/name="([^"]*)"/i);
		if (!nameMatch) continue;
		const name = nameMatch[1];

		const filenameMatch = headerBlock.match(/filename\*=(?:UTF-8|utf-8)''([^;\r\n]+)/i)
			|| headerBlock.match(/filename="([^"]*)"/i);
		if (filenameMatch) {
			let filename = filenameMatch[1];
			try { filename = decodeURIComponent(filename); } catch {}
			results[name] = { filename, buffer: Buffer.from(content), type: "file" };
		} else {
			results[name] = { value: content.toString("utf8"), type: "field" };
		}
	}

	return results;
}

export function parseMultipartBody(buffer, contentType) {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!match) return null;
	const boundary = (match[1] || match[2]).trim();
	if (!boundary) return null;
	return parseMultipart(buffer, boundary);
}
