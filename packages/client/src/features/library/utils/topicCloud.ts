import { scaleSqrt } from "d3";
import type { ScholarTopic } from "../../../core/api";
import type { TopicColorMap } from "../types";

export interface TopicCloudWord {
  text: string;
  weight: number;
  size: number;
  color: string;
  topicId?: number;
}

const DEFAULT_TOPIC_COLOR = "#22c55e";
const GLOBAL_WORD_LIMIT = 24;
const TOPIC_WORD_LIMIT = 14;
const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 18;

function keywordRankWeight(index: number, total: number) {
  if (total <= 1) return 1;
  return 1 - (index / (total - 1)) * 0.55;
}

function sizeWords(words: Omit<TopicCloudWord, "size">[]): TopicCloudWord[] {
  if (words.length === 0) return [];

  const maxWeight = Math.max(...words.map((word) => word.weight), 1);
  const sizeScale = scaleSqrt().domain([0, maxWeight]).range([MIN_FONT_SIZE, MAX_FONT_SIZE]);

  return words.map((word) => ({
    ...word,
    size: Math.round(sizeScale(word.weight) * 10) / 10,
  }));
}

export function buildGlobalTopicCloud(
  topics: ScholarTopic[],
  topicColors: TopicColorMap,
): TopicCloudWord[] {
  const buckets = new Map<
    string,
    {
      text: string;
      weight: number;
      color: string;
      dominantTopicId: number;
      dominantWeight: number;
    }
  >();

  for (const topic of topics) {
    if (topic.id === -1 || topic.keywords.length === 0) continue;

    topic.keywords.forEach((keyword, index) => {
      const text = keyword.trim();
      if (!text) return;

      const key = text.toLocaleLowerCase();
      const contribution =
        Math.max(topic.paperCount, 1) * keywordRankWeight(index, topic.keywords.length);
      const existing = buckets.get(key);

      if (existing) {
        existing.weight += contribution;
        if (contribution > existing.dominantWeight) {
          existing.color = topicColors.get(topic.id) ?? DEFAULT_TOPIC_COLOR;
          existing.dominantTopicId = topic.id;
          existing.dominantWeight = contribution;
        }
        return;
      }

      buckets.set(key, {
        text,
        weight: contribution,
        color: topicColors.get(topic.id) ?? DEFAULT_TOPIC_COLOR,
        dominantTopicId: topic.id,
        dominantWeight: contribution,
      });
    });
  }

  const words = [...buckets.values()]
    .sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text))
    .slice(0, GLOBAL_WORD_LIMIT)
    .map(({ text, weight, color, dominantTopicId }) => ({
      text,
      weight,
      color,
      topicId: dominantTopicId,
    }));

  return sizeWords(words);
}

export function buildTopicCloud(topic: ScholarTopic, topicColors: TopicColorMap): TopicCloudWord[] {
  const color = topicColors.get(topic.id) ?? DEFAULT_TOPIC_COLOR;
  const keywords = topic.keywords.map((keyword) => keyword.trim()).filter(Boolean);

  const words = keywords.slice(0, TOPIC_WORD_LIMIT).map((text, index) => ({
    text,
    weight: Math.max(topic.paperCount, 1) * keywordRankWeight(index, keywords.length),
    color,
    topicId: topic.id,
  }));

  return sizeWords(words);
}
