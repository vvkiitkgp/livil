import React from 'react';
import { detectMentionTrigger, mentionedUsernames, parseMentions, renderInputMentions } from '../mentions';

describe('parseMentions', () => {
  it('splits text and tags, keeping every character', () => {
    expect(parseMentions('this one is for @riya_s and @sam!')).toEqual([
      { type: 'text', value: 'this one is for ' },
      { type: 'mention', value: 'riya_s' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: 'sam' },
      { type: 'text', value: '!' },
    ]);
    expect(parseMentions('@riya first')[0]).toEqual({ type: 'mention', value: 'riya' });
    expect(parseMentions('(@riya)').map(c => c.value)).toEqual(['(', 'riya', ')']);
  });

  it('an email is not a tag; nor is a lone @ or a 1-letter name', () => {
    expect(parseMentions('mail riya@gmail.com')).toEqual([{ type: 'text', value: 'mail riya@gmail.com' }]);
    expect(parseMentions('@ me')).toEqual([{ type: 'text', value: '@ me' }]);
    expect(parseMentions('@a hi')).toEqual([{ type: 'text', value: '@a hi' }]);
  });

  it('a name longer than 30 is not a tag', () => {
    const long = 'a'.repeat(31);
    expect(parseMentions(`@${long}`)).toEqual([{ type: 'text', value: `@${long}` }]);
  });
});

describe('mentionedUsernames', () => {
  it('distinct, lower-cased, in order, at most five', () => {
    expect(mentionedUsernames('@Riya @sam @riya @a1 @b2 @c3 @d4')).toEqual(['riya', 'sam', 'a1', 'b2', 'c3']);
  });
});

describe('detectMentionTrigger', () => {
  it('finds the partial being typed', () => {
    expect(detectMentionTrigger('hey @ri', 7)).toEqual({ start: 4, partial: 'ri' });
    expect(detectMentionTrigger('@', 1)).toEqual({ start: 0, partial: '' });
  });
  it('not inside an email or after a space', () => {
    expect(detectMentionTrigger('riya@gm', 7)).toBeNull();
    expect(detectMentionTrigger('@riya ', 6)).toBeNull();
  });
});

describe('renderInputMentions', () => {
  // The pieces must join to exactly the text, or the caret jumps while typing.
  const flatten = (nodes: React.ReactNode): string =>
    (nodes as React.ReactElement<{ children: string }>[]).map(n => n.props.children).join('');

  it('joins back to exactly the text, tags and all', () => {
    for (const t of ['', 'plain', '@riya', 'for @riya and @Sam!', 'mail a@b.com @x', '@riya_s\n@tom ']) {
      expect(flatten(renderInputMentions(t))).toBe(t);
    }
  });

  it('only the tags carry the tag colour', () => {
    const nodes = renderInputMentions('hi @riya') as React.ReactElement<{ style?: unknown; children: string }>[];
    expect(nodes.map(n => [n.props.children, Boolean(n.props.style)])).toEqual([['hi ', false], ['@riya', true]]);
  });
});
