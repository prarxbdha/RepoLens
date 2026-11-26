use std::collections::HashMap as Map;
use std::fmt::{self, Debug};
use crate::models::User;

pub const MAX_SIZE: usize = 10;
static COUNT: usize = 1;

/// A generic repository.
pub struct Repository<T: Debug> {
    pub items: Map<String, T>,
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Findable<T> {
    fn find(&self, id: usize) -> Option<&T>;
}

impl<T: Debug> Repository<T> {
    pub async fn load(&mut self, id: usize) -> Option<&T> {
        if id < MAX_SIZE {
            self.items.get(&id.to_string())
        } else {
            None
        }
    }

    fn helper(&self) -> bool {
        true
    }
}

pub mod nested {
    pub fn top() -> usize {
        COUNT
    }
}
