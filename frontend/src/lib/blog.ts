import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export interface BlogFrontmatter {
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  title: string;
  excerpt: string;
}

export interface BlogContent {
  frontmatter: BlogFrontmatter;
  content: string;
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
