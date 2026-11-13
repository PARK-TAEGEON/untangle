import { TopicBoard } from "../../../components/topic-board";

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TopicBoard topicId={id} />;
}
