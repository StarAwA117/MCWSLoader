// 简易 multipart/form-data 解析器，仅用于 mod 导入场景

function parseMultipart(buffer, boundary) {
	const results = {};
	const bLen = Buffer.byteLength(boundary);
	const enc = "utf8";
	let pos = 0;

	while (pos < buffer.length) {
		const start = buffer.indexOf(boundary, pos);
		if (start === -1) break;
		const end = buffer.indexOf(boundary, start + bLen);
		if (end === -1) break;

		const part = buffer.slice(start + bLen, end);
		const headerEnd = part.indexOf("\r\n\r\n");
		if (headerEnd === -1) {
			pos = end + bLen;
			continue;
		}

		const headerBlock = part.slice(0, headerEnd).toString(enc);
		const content = part.slice(headerEnd + 4);

		const nameMatch = headerBlock.match(/Content-Disposition: form-data; name="([^"]+)"/);
		const filenameMatch = headerBlock.match(/filename="([^"]+)"/);
		const name = nameMatch ? nameMatch[1] : null;
		const filename = filenameMatch ? filenameMatch[1] : null;

		if (!name) {
			pos = end + bLen;
			continue;
		}

		if (filename) {
			results[name] = { filename, buffer: content, type: "file" };
		} else {
			results[name] = { value: content.toString(enc).trim(), type: "field" };
		}

		pos = end + bLen;
	}

	return results;
}

export function parseMultipartBody(buffer, contentType) {
	const match = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
	if (!match) return null;
	const boundary = (match[1] || match[2]).trim();
	if (!boundary) return null;
	const fullBoundary = "\r\n--" + boundary;
	return parseMultipart(buffer, fullBoundary);
}
