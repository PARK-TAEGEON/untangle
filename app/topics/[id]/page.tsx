import { TopicBoard } from "../../../components/topic-board";
export const metadata = { title: "토픽 보드" };

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TopicBoard topicId={id} />;
}
