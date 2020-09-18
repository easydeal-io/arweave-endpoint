#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(test)]
mod mock;

#[cfg(test)]
mod tests;

use frame_support::{
    decl_module, decl_storage, decl_event, decl_error, ensure,
    dispatch::DispatchResult, 
    traits::{
        Currency, ReservableCurrency
    }
};

use frame_system::{ensure_signed, ensure_root};
use sp_std::vec::Vec;
use codec::{Encode, Decode};

pub type InfoId = u64;
pub type SpaceKey = Vec<u8>;
pub type CountryKey = Vec<u8>;

pub const MAX_LATEST_IDS: usize = 50;

type BalanceOf<T> = <<T as Trait>::Currency as Currency<<T as frame_system::Trait>::AccountId>>::Balance;

#[derive(Decode, Encode)]
pub struct Info<T: Trait> {
    id: InfoId,
    country: CountryKey,
    space: SpaceKey,
    thumb: Vec<u8>,
    title: Vec<u8>,
    content: Vec<u8>,
    images: Vec<u8>,
    price: BalanceOf<T>,
    creator: T::AccountId,
    block: T::BlockNumber,
    status: u8
}

pub trait Trait: frame_system::Trait + space::Trait {
    type Currency: ReservableCurrency<Self::AccountId>;
	type Event: From<Event<Self>> + Into<<Self as frame_system::Trait>::Event>;
}

decl_event! {
    pub enum Event<T> where AccountId = <T as frame_system::Trait>::AccountId {
        InfoPosted(AccountId, InfoId),
    }
}

decl_error! {
    pub enum Error for Module<T: Trait> {
        // title length > 12 && < 64
        TitleLengthIllegal,
        // content length > 30 && <  1024
        ContentLengthIllegal,
        // thumb length < 1024
        ThumbLengthIllegal,
        // images length < 1024
        ImagesLengthIllegal,
        // price > 0 && < 999999999
        PriceIllegal,
        // not found space
        SpaceNotFound,
        // not found info
        InfoNotFound,
        // favorited
        AlreadyFavorited,
        // have not favorited
        HaveNotFavorited,
        // liked
        AlreadyLiked,
        // have not liked
        HaveNotLiked
    }
}

decl_storage! {
    trait Store for Module<T: Trait> as InfoStorage {
        // Get next info id by country
        pub NextInfoId: map hasher(blake2_128_concat) CountryKey => InfoId = 1;

        // double map from CountryKey -> InfoId -> Info
        pub Infos: double_map 
            hasher(blake2_128_concat) CountryKey, 
            hasher(blake2_128_concat) InfoId 
        => Option<Info<T>>;

        pub Favorites: double_map
            hasher(blake2_128_concat) CountryKey, 
            hasher(blake2_128_concat) InfoId
        => Vec<T::AccountId>;

        pub Likes: double_map
            hasher(blake2_128_concat) CountryKey, 
            hasher(blake2_128_concat) InfoId
        => Vec<T::AccountId>;
        
        // Get info by space and country
        pub InfoIds: map hasher(blake2_128_concat) (CountryKey, SpaceKey) => Vec<InfoId>;

        // Get latest info ids by country
        pub LatestInfoIds: map hasher(blake2_128_concat) CountryKey => Vec<InfoId>;
    }
}

decl_module! {
    pub struct Module<T: Trait> for enum Call where origin: T::Origin {
        type Error = Error<T>;

        fn deposit_event() = default;

        #[weight = 10_000]
        fn post(
            origin, space: SpaceKey, country: CountryKey, thumb: Vec<u8>, 
            title: Vec<u8>, content: Vec<u8>, images: Vec<u8>, price: BalanceOf<T>
        ) -> DispatchResult {
            let creator = ensure_signed(origin)?;

            // check space
            ensure!(space::Module::<T>::space_keys().contains(&space), <Error<T>>::SpaceNotFound);

            // check title
            let title_length = title.len();

            ensure!(title_length > 12 && title_length < 64, <Error<T>>::TitleLengthIllegal);

            // check content
            let content_length = content.len();
            ensure!(content_length > 30 && content_length < 1024, <Error<T>>::ContentLengthIllegal);

            // check thumb
            let thumb_length = thumb.len();
            ensure!(thumb_length == 0 || thumb_length < 1024, <Error<T>>::ThumbLengthIllegal);

            // check images
            let images_length = images.len();
            ensure!(images_length == 0 || images_length < 1024, <Error<T>>::ImagesLengthIllegal);

            // check price
            ensure!(
                price > T::Currency::minimum_balance() &&
                price < T::Currency::total_issuance() , 
                <Error<T>>::PriceIllegal
            );

            // get next info id by country
            let next_info_id = NextInfoId::get(&country);
            let current_block = <frame_system::Module<T>>::block_number();
            let info: Info<T> = Info {
                id: next_info_id, country: country.clone(), space: space.clone(), 
                thumb, title, content, images, price, creator: creator.clone(), 
                block: current_block, status: 1
            };

            Infos::insert(&country, next_info_id, info);
            NextInfoId::mutate(&country, |n| { *n += 1; });
            InfoIds::mutate((&country, &space), |ids| ids.push(next_info_id));

            // get latest info ids
            let mut tmp_ids: Vec<InfoId> = LatestInfoIds::get(&country);
            if tmp_ids.len() >= MAX_LATEST_IDS {
                tmp_ids.remove(0);
            }
            tmp_ids.push(next_info_id);
            LatestInfoIds::insert(&country, tmp_ids);
            
            Self::deposit_event(RawEvent::InfoPosted(creator, next_info_id));

            Ok(())
        }

        #[weight = 10_000]
        fn favorite(
            origin, country: CountryKey, id: InfoId
        ) -> DispatchResult {
            let creator = ensure_signed(origin)?;

            let info = <Infos<T>>::get(&country, &id);

            ensure!(info.is_some(), <Error<T>>::InfoNotFound);

            let mut favorites = <Favorites<T>>::get(&country, &id);
            ensure!(!favorites.contains(&creator), <Error<T>>::AlreadyFavorited);

            favorites.push(creator);
            <Favorites<T>>::insert(country, id, favorites);

            Ok(())
        }

        #[weight = 10_000]
        fn un_favorite(
            origin, country: CountryKey, id: InfoId
        ) -> DispatchResult {
            let creator = ensure_signed(origin)?;

            let info = <Infos<T>>::get(&country, &id);

            ensure!(info.is_some(), <Error<T>>::InfoNotFound);

            let mut favorites = <Favorites<T>>::get(&country, &id);
            ensure!(favorites.contains(&creator), <Error<T>>::HaveNotFavorited);

            favorites.retain(|x| x != &creator);
            <Favorites<T>>::insert(country, id, favorites);

            Ok(())
        }

        #[weight = 10_000]
        fn like(
            origin, country: CountryKey, id: InfoId
        ) -> DispatchResult {
            let creator = ensure_signed(origin)?;

            let info = <Infos<T>>::get(&country, &id);

            ensure!(info.is_some(), <Error<T>>::InfoNotFound);

            let mut likes = <Likes<T>>::get(&country, &id);
            ensure!(!likes.contains(&creator), <Error<T>>::AlreadyLiked);

            likes.push(creator);
            <Likes<T>>::insert(country, id, likes);

            Ok(())
        }

        #[weight = 10_000]
        fn un_like(
            origin, country: CountryKey, id: InfoId
        ) -> DispatchResult {
            let creator = ensure_signed(origin)?;

            let info = <Infos<T>>::get(&country, &id);

            ensure!(info.is_some(), <Error<T>>::InfoNotFound);

            let mut likes = <Likes<T>>::get(&country, &id);
            ensure!(likes.contains(&creator), <Error<T>>::HaveNotLiked);

            likes.retain(|x| x != &creator);
            <Likes<T>>::insert(country, id, likes);

            Ok(())
        }

        #[weight = 10_000]
        fn propose(
            origin, country: CountryKey, id: InfoId
        ) -> DispatchResult {
            ensure_signed(origin)?;

            if let Some(info) = <Infos<T>>::get(&country, &id) {
                let new_info: Info<T> = Info {
                    status: 2,
                    ..info
                };

                Infos::insert(&country, id, new_info);
                Ok(())
            } else {
                Err(<Error<T>>::InfoNotFound)?
            }
           
        }

        #[weight = 10_000]
        fn remove(
            origin, country: CountryKey, id: InfoId
        ) {
            ensure_root(origin)?;
            let info = <Infos<T>>::get(&country, &id);

            ensure!(info.is_some(), <Error<T>>::InfoNotFound);

            <Infos<T>>::remove(country, id);
        }
    }
}