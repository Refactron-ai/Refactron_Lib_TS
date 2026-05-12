// Legacy promise-chain style. Target transform: async/await.

async function fetchUser(id) {
  return Promise.resolve({ id: id, name: 'user-' + id });
}

async function fetchPosts(userId) {
  return Promise.resolve([
    { id: 1, userId: userId, title: 'first' },
    { id: 2, userId: userId, title: 'second' },
  ]);
}

export function loadProfile(id) {
  return fetchUser(id).then((u) =>
    fetchPosts(u.id).then((posts) => ({ user: u, posts: posts })),
  );
}
