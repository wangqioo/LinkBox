import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, type Friendship, type GroupMaterial, type GroupMessage, type LinkBoxGroup } from '../api/client';
import { Bot, Check, FilePlus2, Loader2, MessageSquare, Plus, Search, Send, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import MarkdownRenderer from '../components/MarkdownRenderer';

interface LinkOption {
  id: number;
  title: string;
  url: string;
  type: string;
}

function normalizeRows(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

export default function SocialPage() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [groups, setGroups] = useState<LinkBoxGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<number | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [materials, setMaterials] = useState<GroupMaterial[]>([]);
  const [links, setLinks] = useState<LinkOption[]>([]);
  const [friendName, setFriendName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [messageText, setMessageText] = useState('');
  const [assistantText, setAssistantText] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState('');
  const [shareLinkId, setShareLinkId] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [error, setError] = useState('');

  const acceptedFriends = useMemo(() => friends.filter(friend => friend.status === 'accepted'), [friends]);
  const incomingFriends = useMemo(() => friends.filter(friend => friend.status === 'pending' && friend.direction === 'incoming'), [friends]);
  const outgoingFriends = useMemo(() => friends.filter(friend => friend.status === 'pending' && friend.direction === 'outgoing'), [friends]);
  const activeGroup = groups.find(group => group.id === activeGroupId) || groups[0] || null;

  const loadSocial = async () => {
    const [friendRows, groupRows, linkRows] = await Promise.all([
      api.getFriends(),
      api.getGroups(),
      api.getLinks({ limit: '100' }),
    ]);
    setFriends(friendRows);
    setGroups(groupRows);
    setLinks(normalizeRows(linkRows).map((item: any) => ({
      id: item.id,
      title: item.title || item.url || `资料 ${item.id}`,
      url: item.url || '',
      type: item.type || 'link',
    })));
    if (!activeGroupId && groupRows.length) setActiveGroupId(groupRows[0].id);
  };

  const loadGroup = async (groupId: number) => {
    const [messageRows, materialRows] = await Promise.all([
      api.getGroupMessages(groupId),
      api.getGroupMaterials(groupId),
    ]);
    setMessages(messageRows);
    setMaterials(materialRows);
  };

  useEffect(() => {
    setLoading(true);
    loadSocial().catch(e => setError(e.message || '加载社交数据失败')).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeGroupId) return;
    loadGroup(activeGroupId).catch(e => setError(e.message || '加载群聊失败'));
  }, [activeGroupId]);

  const addFriend = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    await api.addFriend(friendName);
    setFriendName('');
    await loadSocial();
  };

  const createGroup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const result = await api.createGroup({
      name: groupName,
      description: groupDescription,
      agent_name: '群资料助手',
      member_ids: selectedMemberIds,
    });
    setGroupName('');
    setGroupDescription('');
    setSelectedMemberIds([]);
    await loadSocial();
    if (result.id) setActiveGroupId(result.id);
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !messageText.trim()) return;
    const message = await api.sendGroupMessage(activeGroup.id, messageText);
    setMessages(prev => [...prev, message]);
    setMessageText('');
  };

  const shareMaterial = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !shareLinkId) return;
    await api.shareLinkToGroup(activeGroup.id, Number(shareLinkId), shareNote);
    setShareLinkId('');
    setShareNote('');
    await loadGroup(activeGroup.id);
    await loadSocial();
  };

  const askGroupAgent = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeGroup || !assistantText.trim() || assistantLoading) return;
    setAssistantAnswer('');
    setAssistantLoading(true);
    try {
      await api.streamAssistant(assistantText, 'ask', {
        groupId: activeGroup.id,
        onDelta: text => setAssistantAnswer(prev => prev + text),
      });
      setAssistantText('');
    } catch (err) {
      setAssistantAnswer(err instanceof Error ? err.message : '群资料助手暂时无法回答');
    } finally {
      setAssistantLoading(false);
    }
  };

  const toggleMember = (id: number) => {
    setSelectedMemberIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">好友与群聊</h1>
          <p className="text-sm text-gray-500">和好友建群、发送群消息、共享重要资料，每个群都有独立资料助手。</p>
        </div>
        {loading && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />加载中</div>}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        <aside className="space-y-4">
          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-indigo-600" />
              <h2 className="font-semibold">我的群聊</h2>
            </div>
            <div className="space-y-2">
              {groups.map(group => (
                <button key={group.id} type="button" onClick={() => setActiveGroupId(group.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 ${activeGroup?.id === group.id ? 'border-indigo-300 bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}>
                  <div className="font-medium truncate">{group.name}</div>
                  <div className="text-xs text-gray-500 mt-1">{group.member_count || 1} 人 · {group.material_count || 0} 条资料</div>
                </button>
              ))}
              {!groups.length && <div className="text-sm text-gray-500">还没有群聊，先和好友创建一个。</div>}
            </div>
          </section>

          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <UserPlus className="w-4 h-4 text-indigo-600" />
              <h2 className="font-semibold">加好友</h2>
            </div>
            <form onSubmit={addFriend} className="flex gap-2">
              <input value={friendName} onChange={e => setFriendName(e.target.value)} className="input flex-1" placeholder="输入用户名" />
              <button className="btn-primary px-3" type="submit"><Plus className="w-4 h-4" /></button>
            </form>
            {!!incomingFriends.length && (
              <div className="mt-3 space-y-2">
                {incomingFriends.map(friend => (
                  <div key={friend.id} className="flex items-center justify-between rounded-lg bg-gray-50 dark:bg-gray-800 px-2 py-1.5 text-sm">
                    <span>{friend.user.username}</span>
                    <button type="button" onClick={async () => { await api.acceptFriend(friend.id); await loadSocial(); }} className="btn-ghost px-2 py-1"><Check className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
            {!!outgoingFriends.length && <div className="mt-3 text-xs text-gray-500">待通过：{outgoingFriends.map(friend => friend.user.username).join('、')}</div>}
          </section>

          <section className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Plus className="w-4 h-4 text-indigo-600" />
              <h2 className="font-semibold">建群聊</h2>
            </div>
            <form onSubmit={createGroup} className="space-y-3">
              <input value={groupName} onChange={e => setGroupName(e.target.value)} className="input w-full" placeholder="群名称" />
              <AutoGrowTextarea value={groupDescription} onChange={e => setGroupDescription(e.target.value)} className="input w-full min-h-[42px]" placeholder="群说明" maxHeight={160} />
              <div className="space-y-1.5 max-h-36 overflow-auto">
                {acceptedFriends.map(friend => (
                  <label key={friend.user.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedMemberIds.includes(friend.user.id)} onChange={() => toggleMember(friend.user.id)} />
                    {friend.user.username}
                  </label>
                ))}
              </div>
              <button type="submit" className="btn-primary w-full justify-center" disabled={!groupName.trim()}>
                创建群聊
              </button>
            </form>
          </section>
        </aside>

        <main className="space-y-4 min-w-0">
          {activeGroup ? (
            <>
              <section className="card p-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{activeGroup.name}</h2>
                    <p className="text-sm text-gray-500">{activeGroup.description || '这个群还没有说明。'}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-indigo-600 dark:text-indigo-400">
                    <Bot className="w-4 h-4" />{activeGroup.agent_name || '群资料助手'}
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <section className="card p-4 min-h-[420px] flex flex-col">
                  <div className="flex items-center gap-2 mb-3"><MessageSquare className="w-4 h-4 text-indigo-600" /><h3 className="font-semibold">群消息</h3></div>
                  <div className="flex-1 overflow-auto space-y-3 pr-1">
                    {messages.map(message => (
                      <div key={message.id} className={`flex ${message.user_id === user?.id ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[82%] rounded-lg px-3 py-2 ${message.user_id === user?.id ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>
                          <div className="text-[11px] opacity-75 mb-1">{message.user.username}</div>
                          {message.message_type === 'material' ? (
                            <div className="text-sm">
                              <div className="font-medium">{message.material?.title || message.body}</div>
                              <div className="text-xs opacity-75 mt-1">{message.material?.summary || message.material?.url || '群资料'}</div>
                            </div>
                          ) : (
                            <div className="text-sm whitespace-pre-wrap break-words">{message.body}</div>
                          )}
                        </div>
                      </div>
                    ))}
                    {!messages.length && <div className="text-sm text-gray-500">还没有群消息。</div>}
                  </div>
                  <form onSubmit={sendMessage} className="mt-3 flex gap-2">
                    <AutoGrowTextarea value={messageText} onChange={e => setMessageText(e.target.value)} className="input flex-1 min-h-10" placeholder="发一条群消息" maxHeight={140} />
                    <button className="btn-primary px-3" type="submit"><Send className="w-4 h-4" /></button>
                  </form>
                </section>

                <section className="card p-4 min-h-[420px] flex flex-col">
                  <div className="flex items-center gap-2 mb-3"><Bot className="w-4 h-4 text-indigo-600" /><h3 className="font-semibold">群资料助手</h3></div>
                  <form onSubmit={askGroupAgent} className="flex gap-2 mb-3">
                    <AutoGrowTextarea value={assistantText} onChange={e => setAssistantText(e.target.value)} className="input flex-1 min-h-10" placeholder="向这个群的资料助手提问" maxHeight={140} />
                    <button className="btn-primary px-3" type="submit" disabled={assistantLoading}>{assistantLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</button>
                  </form>
                  <div className="flex-1 overflow-auto rounded-lg bg-gray-50 dark:bg-gray-800/60 p-3 text-sm">
                    {assistantAnswer ? <MarkdownRenderer content={assistantAnswer} /> : <span className="text-gray-500">群助手只会读取这个群里共享过的资料。</span>}
                  </div>
                </section>
              </div>

              <section className="card p-4">
                <div className="flex items-center gap-2 mb-3"><FilePlus2 className="w-4 h-4 text-indigo-600" /><h3 className="font-semibold">群资料</h3></div>
                <form onSubmit={shareMaterial} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 mb-4">
                  <select value={shareLinkId} onChange={e => setShareLinkId(e.target.value)} className="input">
                    <option value="">选择我的资料</option>
                    {links.map(link => <option key={link.id} value={link.id}>{link.title}</option>)}
                  </select>
                  <AutoGrowTextarea value={shareNote} onChange={e => setShareNote(e.target.value)} className="input min-h-10" placeholder="补充说明" maxHeight={140} />
                  <button type="submit" className="btn-primary justify-center" disabled={!shareLinkId}>发送到群</button>
                </form>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {materials.map(material => (
                    <article key={material.link_id} className="rounded-lg border px-3 py-2 bg-white dark:bg-gray-900">
                      <div className="text-sm font-medium truncate">{material.title || material.url || `资料 ${material.link_id}`}</div>
                      <div className="text-xs text-gray-500 mt-1">由 {material.shared_by_user.username} 共享 · {material.type}</div>
                      {material.note && <div className="text-xs text-gray-600 dark:text-gray-300 mt-2">{material.note}</div>}
                      {material.summary && <div className="text-xs text-gray-500 mt-2 line-clamp-2">{material.summary}</div>}
                    </article>
                  ))}
                  {!materials.length && <div className="text-sm text-gray-500">还没有共享资料。</div>}
                </div>
              </section>
            </>
          ) : (
            <section className="card p-8 text-center text-gray-500">添加好友并创建一个群后，就可以发群消息和共享群资料。</section>
          )}
        </main>
      </div>
    </div>
  );
}
