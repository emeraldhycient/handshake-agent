import { renderTemplate } from './notification-template-renderer';

describe('renderTemplate', () => {
  it('replaces a single known placeholder', () => {
    expect(renderTemplate('Hi {{name}}', { name: 'Ada' })).toBe('Hi Ada');
  });

  it('replaces multiple distinct placeholders', () => {
    expect(
      renderTemplate('{{greeting}}, {{name}}!', {
        greeting: 'Hello',
        name: 'Ada',
      }),
    ).toBe('Hello, Ada!');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    expect(renderTemplate('{{x}}-{{x}}', { x: '7' })).toBe('7-7');
  });

  it('renders an unknown placeholder as blank', () => {
    expect(renderTemplate('Hi {{name}}', {})).toBe('Hi ');
  });

  it('tolerates inner whitespace in the placeholder', () => {
    expect(renderTemplate('Hi {{ name }}', { name: 'Ada' })).toBe('Hi Ada');
  });

  it('leaves a content string with no placeholders unchanged', () => {
    expect(renderTemplate('No vars here', { name: 'Ada' })).toBe(
      'No vars here',
    );
  });

  it('returns an empty string for empty content', () => {
    expect(renderTemplate('', { name: 'Ada' })).toBe('');
  });
});
