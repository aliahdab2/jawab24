import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface BlogFrontmatter {
  seoTitle: string;
  seoDescription: string;
  title: string;
  excerpt: string;
}

export interface BlogContent {
  frontmatter: BlogFrontmatter;
  content: string;
}

export interface ImageSize {
  width: number;
  height: number;
}

/** Parse intrinsic dimensions from a PNG or WebP header (no image library needed). */
function readImageSize(buf: Buffer): ImageSize | null {
  // PNG: 8-byte signature, IHDR width/height at bytes 16–23
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WebP: RIFF container, "WEBP" fourcc, then VP8/VP8L/VP8X chunk
  if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/**
 * Collect intrinsic sizes for every markdown image in a post so the renderer
 * can use next/image with explicit dimensions (no CLS). Build-time only.
 * Guide images must live under frontend/public (e.g. /images/blog/...) —
 * remote or missing images fail the build here, on purpose.
 */
export function extractImageSizes(content: string): Record<string, ImageSize> {
  const sizes: Record<string, ImageSize> = {};
  const imageRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(content)) !== null) {
    const src = match[1];
    if (sizes[src]) continue;
    if (!src.startsWith('/')) {
      throw new Error(
        `Blog image "${src}" must be a local path under frontend/public (e.g. /images/blog/...).`,
      );
    }
    const filePath = path.join(process.cwd(), 'public', src);
    const size = readImageSize(fs.readFileSync(filePath));
    if (!size) {
      throw new Error(`Blog image "${src}" is not a readable PNG/WebP — cannot determine dimensions.`);
    }
    sizes[src] = size;
  }
  return sizes;
}

/**
 * Load a blog post's Markdown file and parse its frontmatter.
 * Only works server-side (getStaticProps) — uses Node.js `fs`.
 */
export function loadBlogPost(slug: string, locale: string): BlogContent {
  const filePath = path.join(
    process.cwd(),
    'src',
    'content',
    'blog',
    locale === 'en' ? 'en' : 'ar',
    `${slug}.md`,
  );
  const fileContents = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContents);

  return {
    frontmatter: data as BlogFrontmatter,
    content,
  };
}
