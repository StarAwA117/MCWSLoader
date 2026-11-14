// 简易 multipart/form-data 解析器，仅用于 mod 导入场景

const CR = 0x0d;
const LF = 0x0a;
const DASH = 0x2d;

export interface MultipartFile {
	filename: string;
	buffer: Buffer;
	type: "file";
}

export interface MultipartField {
	value: string;
	type: "field";
}

export type MultipartPart = MultipartFile | MultipartField;
export type MultipartResult = Record<string, MultipartPart>;

function parseMultipart(buffer: Buffer, boundary: string): MultipartResult {
	const results: MultipartResult = {};
	const marker = Buffer.from(`--${boundary}`, "latin1");

	// 找出所有「行首」的 boundary 位置（行首或 CRLF 之后），避免误匹配二进制内容
	const offsets: number[] = [];
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
		const offset = offsets[i];
		if (offset === undefined) continue;
		let start = offset + marker.length;
		// 结束标记 "--boundary--"，没有后续内容
		if (buffer[start] === DASH && buffer[start + 1] === DASH) continue;
		if (buffer[start] === CR && buffer[start + 1] === LF) start += 2;

		let end = offsets[i + 1];
		if (end === undefined) continue;
		if (end >= 2 && buffer[end - 2] === CR && buffer[end - 1] === LF) end -= 2;

		const part = buffer.subarray(start, end);
		const headerEnd = part.indexOf("\r\n\r\n");
		if (headerEnd === -1) continue;

		const headerBlock = part.subarray(0, headerEnd).toString("utf8");
		const content = part.subarray(headerEnd + 4);

		const nameMatch = /name="([^"]*)"/i.exec(headerBlock);
		if (!nameMatch?.[1]) continue;
		const name = nameMatch[1];

		const filenameMatch =
			/filename\*=(?:UTF-8|utf-8)''([^;\r\n]+)/i.exec(headerBlock) ??
			/filename="([^"]*)"/i.exec(headerBlock);

		if (filenameMatch?.[1] !== undefined) {
			let filename = filenameMatch[1];
			try {
				filename = decodeURIComponent(filename);
			} catch {
				// keep raw filename
			}
			results[name] = { filename, buffer: content, type: "file" };
		} else {
			results[name] = { value: content.toString("utf8"), type: "field" };
		}
	}

	return results;
}

export function parseMultipartBody(buffer: Buffer, contentType: string): MultipartResult | null {
	const match = /boundary=(?:"([^"]+)"|([^\s;]+))/.exec(contentType);
	if (!match) return null;
	const boundary = (match[1] ?? match[2] ?? "").trim();
	if (!boundary) return null;
	return parseMultipart(buffer, boundary);
}
