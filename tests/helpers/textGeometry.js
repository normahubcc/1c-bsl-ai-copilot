// Controlled VS Code document boundary for host tests. Runtime uses the actual editor APIs.
exports.textGeometry = (getText, Position) => ({
    offsetAt(position) {
        const lines = getText().split('\n');
        const line = Math.max(0, Math.min(position.line, lines.length - 1));
        const length = lines[line].replace(/\r$/, '').length;
        return lines.slice(0, line).reduce((offset, value) => offset + value.length + 1, 0) + Math.max(0, Math.min(position.character, length));
    },
    positionAt(offset) {
        const source = getText(), lines = source.split('\n');
        let remaining = Math.max(0, Math.min(offset, source.length));
        for (let line = 0; line < lines.length; line++) {
            if (remaining <= lines[line].length || line === lines.length - 1) return new Position(line, Math.min(remaining, lines[line].replace(/\r$/, '').length));
            remaining -= lines[line].length + 1;
        }
    }
});
