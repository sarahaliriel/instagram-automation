import Image from "next/image";
import { getPosts } from "@/server/dashboard/read-model";
import { AvailabilityState, PageHeader, formatDate } from "../ui";

export default async function PostsPage() {
  const data = await getPosts();
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Conteúdo"
        title="Publicações"
        description="A primeira página de conteúdos da conta Instagram autorizada, consultada diretamente e sem operações de escrita."
      />
      {data.items.length ? (
        <section className="posts-grid" aria-label="Publicações da conta">
          {data.items.map((post) => (
            <article className="post-card" key={post.id}>
              <div className="post-image">
                {post.imageUrl ? (
                  <Image
                    src={post.imageUrl}
                    alt=""
                    fill
                    sizes="(max-width: 620px) 100vw, (max-width: 900px) 50vw, 33vw"
                    unoptimized
                  />
                ) : (
                  <span>
                    {post.mediaType === "VIDEO"
                      ? "Vídeo"
                      : "Sem pré-visualização"}
                  </span>
                )}
              </div>
              <div className="post-copy">
                <span>
                  {post.mediaType === "CAROUSEL_ALBUM"
                    ? "Carrossel"
                    : post.mediaType === "VIDEO"
                      ? "Vídeo"
                      : "Imagem"}
                </span>
                <h2>{post.caption?.trim() || "Publicação sem legenda"}</h2>
                <time dateTime={post.timestamp.toISOString()}>
                  {formatDate(post.timestamp)}
                </time>
                {post.permalink && (
                  <a href={post.permalink} target="_blank" rel="noreferrer">
                    Abrir no Instagram
                  </a>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <AvailabilityState
          availability={data.availability}
          emptyTitle="Nenhuma publicação encontrada"
        />
      )}
    </div>
  );
}
